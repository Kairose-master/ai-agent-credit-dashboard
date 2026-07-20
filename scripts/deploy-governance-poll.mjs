#!/usr/bin/env node
/**
 * Deploy GovernancePoll.sol to Sepolia (or any EVM chain) and print the
 * address to set as GOVERNANCE_POLL_ADDRESS.
 *
 * Prereqs (one-time):   pnpm add -D solc
 * Env:
 *   DEPLOYER_PRIVATE_KEY   funded key that pays gas (0x…64 hex)
 *   ONCHAIN_RPC_URL        (or SEPOLIA_RPC_URL) an RPC endpoint
 *   ONCHAIN_CHAIN          'sepolia' (default) | 'base-sepolia'
 *
 * Run:   node scripts/deploy-governance-poll.mjs
 *
 * Then set GOVERNANCE_POLL_ADDRESS to the printed address in your platform
 * env. Governance stays fully off-chain until that variable is set — this
 * deploy is the switch that turns the on-chain commit-reveal path on.
 *
 * Prefer no local tooling? See contracts/README.md for the Remix path.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia, baseSepolia } from 'viem/chains'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'contracts', 'GovernancePoll.sol'), 'utf8')

const rpcUrl = process.env.ONCHAIN_RPC_URL || process.env.SEPOLIA_RPC_URL
const pk = process.env.DEPLOYER_PRIVATE_KEY
if (!rpcUrl) throw new Error('Set ONCHAIN_RPC_URL (or SEPOLIA_RPC_URL).')
if (!pk) throw new Error('Set DEPLOYER_PRIVATE_KEY (a funded testnet key).')
const chain = process.env.ONCHAIN_CHAIN === 'base-sepolia' ? baseSepolia : sepolia

// Compile with solc (lazy import so the app doesn't depend on it).
const solc = (await import('solc')).default
const input = {
  language: 'Solidity',
  sources: { 'GovernancePoll.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
}
const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (out.errors || []).filter((e) => e.severity === 'error')
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join('\n'))
  process.exit(1)
}
const artifact = out.contracts['GovernancePoll.sol'].GovernancePoll
const abi = artifact.abi
const bytecode = `0x${artifact.evm.bytecode.object}`

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) })
const pub = createPublicClient({ chain, transport: http(rpcUrl) })

console.log(`Deploying GovernancePoll to ${chain.name} from ${account.address}…`)
const hash = await wallet.deployContract({ abi, bytecode })
console.log(`  tx: ${hash}`)
const receipt = await pub.waitForTransactionReceipt({ hash })
if (!receipt.contractAddress) throw new Error('No contract address in receipt — deploy failed.')

console.log('\n✅ Deployed.')
console.log(`   GOVERNANCE_POLL_ADDRESS=${receipt.contractAddress}`)
console.log('\nSet that in your platform env (and redeploy) to turn on-chain governance on.')
