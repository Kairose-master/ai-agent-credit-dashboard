/**
 * On-chain half of the GIWA MiniVault engine. The pure math lives in
 * lib/mini-vault.ts; this module deploys/talks to contracts/MiniVault.sol
 * (same parameters, so every chain read can be cross-checked against the
 * unit-tested TS engine).
 *
 * The deployer/oracle is the platform oracle wallet — already funded for EAS
 * writes. The deployed address is stored in platform_secrets
 * ('minivault_address') so no env change or redeploy is needed to adopt it.
 */
import { formatEther, parseEther, type Address, type Hex } from 'viem'
import { MINIVAULT_ABI, MINIVAULT_BYTECODE } from './minivault-artifact'
import { oracleWallet, publicClient } from './clients'
import { getPlatformSecret, setPlatformSecret } from '@/lib/platform-secret'

const ADDRESS_KEY = 'minivault_address'
const WAD = 10n ** 18n

export async function miniVaultAddress(): Promise<Address | null> {
  const stored = (await getPlatformSecret(ADDRESS_KEY)) || process.env.MINIVAULT_ADDRESS || null
  return stored && /^0x[0-9a-fA-F]{40}$/.test(stored) ? (stored as Address) : null
}

/** Deploy MiniVault with an initial mock price (USD/ETH, human units) and
 *  persist the address. Idempotent-ish: refuses if one is already stored
 *  unless `force`. */
export async function deployMiniVault(initialPriceUsd: number, force = false): Promise<{ address: Address; txHash: Hex }> {
  const existing = await miniVaultAddress()
  if (existing && !force) throw new Error(`MiniVault already deployed at ${existing} (pass force to redeploy)`)

  const wallet = oracleWallet()
  const txHash = await wallet.deployContract({
    abi: MINIVAULT_ABI,
    bytecode: MINIVAULT_BYTECODE,
    args: [parseEther(String(initialPriceUsd))],
  })
  const receipt = await publicClient().waitForTransactionReceipt({ hash: txHash })
  if (!receipt.contractAddress) throw new Error('deploy receipt has no contract address')
  await setPlatformSecret(ADDRESS_KEY, receipt.contractAddress)
  return { address: receipt.contractAddress, txHash }
}

/** Oracle Mock: push a new USD/ETH price (human units). */
export async function setMiniVaultPrice(priceUsd: number): Promise<Hex> {
  const address = await miniVaultAddress()
  if (!address) throw new Error('MiniVault not deployed')
  const wallet = oracleWallet()
  return wallet.writeContract({
    address,
    abi: MINIVAULT_ABI,
    functionName: 'setPrice',
    args: [parseEther(String(priceUsd))],
  })
}

export interface MiniVaultState {
  address: Address
  priceUsd: number
  totalSupplyGusd: number
}

export interface MiniVaultPosition {
  collateralEth: number
  debtGusd: number
  collateralValueUsd: number
  maxDebtUsd: number
  healthFactor: number | null // null = debt-free (∞)
  liquidatable: boolean
}

const toNum = (wei: bigint) => Number(formatEther(wei))

export async function readMiniVaultState(): Promise<MiniVaultState | null> {
  const address = await miniVaultAddress()
  if (!address) return null
  const client = publicClient()
  const [price, totalSupply] = await Promise.all([
    client.readContract({ address, abi: MINIVAULT_ABI, functionName: 'price' }),
    client.readContract({ address, abi: MINIVAULT_ABI, functionName: 'totalSupply' }),
  ])
  return { address, priceUsd: toNum(price as bigint), totalSupplyGusd: toNum(totalSupply as bigint) }
}

export async function readMiniVaultPosition(user: Address): Promise<MiniVaultPosition | null> {
  const address = await miniVaultAddress()
  if (!address) return null
  const client = publicClient()
  const [pos, value, maxDebt, hf, liq] = await Promise.all([
    client.readContract({ address, abi: MINIVAULT_ABI, functionName: 'positions', args: [user] }),
    client.readContract({ address, abi: MINIVAULT_ABI, functionName: 'collateralValueUsd', args: [user] }),
    client.readContract({ address, abi: MINIVAULT_ABI, functionName: 'maxDebtUsd', args: [user] }),
    client.readContract({ address, abi: MINIVAULT_ABI, functionName: 'healthFactor', args: [user] }),
    client.readContract({ address, abi: MINIVAULT_ABI, functionName: 'isLiquidatable', args: [user] }),
  ])
  const [collateral, debt] = pos as [bigint, bigint]
  const hfWei = hf as bigint
  return {
    collateralEth: toNum(collateral),
    debtGusd: toNum(debt),
    collateralValueUsd: toNum(value as bigint),
    maxDebtUsd: toNum(maxDebt as bigint),
    healthFactor: debt === 0n ? null : Number(hfWei) / Number(WAD),
    liquidatable: liq as boolean,
  }
}

/** Live walkthrough as the oracle account: deposit a sliver of ETH and mint
 *  half of the allowed debt — enough to light up every gauge on-chain. */
export async function demoDepositAndMint(depositEth: number): Promise<{ depositTx: Hex; mintTx: Hex; minted: number }> {
  const address = await miniVaultAddress()
  if (!address) throw new Error('MiniVault not deployed')
  const wallet = oracleWallet()
  const client = publicClient()

  const depositTx = await wallet.writeContract({
    address,
    abi: MINIVAULT_ABI,
    functionName: 'deposit',
    value: parseEther(String(depositEth)),
  })
  await client.waitForTransactionReceipt({ hash: depositTx })

  const maxDebt = (await client.readContract({
    address,
    abi: MINIVAULT_ABI,
    functionName: 'maxDebtUsd',
    args: [wallet.account.address],
  })) as bigint
  const pos = (await client.readContract({
    address,
    abi: MINIVAULT_ABI,
    functionName: 'positions',
    args: [wallet.account.address],
  })) as [bigint, bigint]
  const headroom = maxDebt - pos[1]
  const mintAmount = headroom / 2n
  if (mintAmount <= 0n) throw new Error('no mint headroom')

  const mintTx = await wallet.writeContract({
    address,
    abi: MINIVAULT_ABI,
    functionName: 'mint',
    args: [mintAmount],
  })
  await client.waitForTransactionReceipt({ hash: mintTx })
  return { depositTx, mintTx, minted: toNum(mintAmount) }
}
