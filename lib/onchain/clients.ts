import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { CHAIN, onchainEnv } from './config'

/** Read-only client for Sepolia. */
export function publicClient() {
  return createPublicClient({ chain: CHAIN, transport: http(onchainEnv.rpcUrl) })
}

/** The oracle account — a plain EOA that publishes credit limits and writes
 *  EAS attestations. Must be funded with Sepolia ETH for gas. */
export function oracleAccount() {
  const pk = onchainEnv.oraclePrivateKey
  return privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
}

/** Wallet client that signs/sends as the oracle. */
export function oracleWallet() {
  return createWalletClient({
    account: oracleAccount(),
    chain: CHAIN,
    transport: http(onchainEnv.rpcUrl),
  })
}
