/**
 * Treasury layer: the agent's smart account as a real wallet.
 * Deposits are just transfers to the account address; withdrawals/payments
 * are USDC transfers executed as sponsored UserOps from the agent's account.
 */
import { encodeFunctionData, parseUnits, type Address, type Hex } from 'viem'
import { USDC_ABI, USDC_DECIMALS, onchainEnv } from './config'
import { publicClient } from './clients'
import { sendAgentCall } from './account'

const TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const

// MockUSDC.mint is permissionless on testnet — anyone (including the agent's
// own smart account) may mint to any address. This lets users self-fund test
// USDC entirely in-app, no CLI or deployer key required.
const MINT_ABI = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const

export async function usdcBalanceOf(address: Address): Promise<number> {
  const value = (await publicClient().readContract({
    address: onchainEnv.usdcAddress as Address,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [address],
  })) as bigint
  return Number(value) / 10 ** USDC_DECIMALS
}

/** Send USDC from the agent's smart account to any external address. */
export async function transferUsdc(agentId: string, to: Address, amountUsd: number): Promise<Hex> {
  const data = encodeFunctionData({
    abi: TRANSFER_ABI,
    functionName: 'transfer',
    args: [to, parseUnits(amountUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS)],
  })
  return sendAgentCall(agentId, { to: onchainEnv.usdcAddress as Address, data })
}

/** Self-mint test USDC into the agent's own smart account (testnet only). */
export async function mintTestUsdc(agentId: string, amountUsd: number, toAddress: Address): Promise<Hex> {
  const data = encodeFunctionData({
    abi: MINT_ABI,
    functionName: 'mint',
    args: [toAddress, parseUnits(amountUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS)],
  })
  return sendAgentCall(agentId, { to: onchainEnv.usdcAddress as Address, data })
}
