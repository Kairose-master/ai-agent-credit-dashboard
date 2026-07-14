/**
 * On-chain layer configuration (Ethereum Sepolia).
 *
 * The whole on-chain layer is OPTIONAL and gated on these env vars — when
 * they're absent the app runs exactly as before (off-chain only). When set,
 * the credit engine mirrors each recalculated limit to the registry and
 * attests the score via EAS, and agents can draw/repay real (test) USDC
 * through their ZeroDev smart accounts.
 */
import { sepolia } from 'viem/chains'

export const CHAIN = sepolia
export const USDC_DECIMALS = 6

export const onchainEnv = {
  rpcUrl: process.env.SEPOLIA_RPC_URL ?? '',
  zerodevRpc: process.env.ZERODEV_RPC ?? '', // bundler + paymaster (ZeroDev v3 RPC)
  oraclePrivateKey: process.env.ORACLE_PRIVATE_KEY ?? '', // publishes limits + attests
  agentOwnerPrivateKey: process.env.AGENT_OWNER_PRIVATE_KEY ?? '', // signer behind every agent account
  registryAddress: (process.env.CREDIT_REGISTRY_ADDRESS ?? '') as `0x${string}` | '',
  vaultAddress: (process.env.CREDIT_VAULT_ADDRESS ?? '') as `0x${string}` | '',
  usdcAddress: (process.env.MOCK_USDC_ADDRESS ?? '') as `0x${string}` | '',
  easAddress: (process.env.EAS_ADDRESS ??
    '0xC2679fBD37d54388Ce493F1DB75320D236e1815e') as `0x${string}`, // EAS on Sepolia
  easSchemaUid: (process.env.EAS_SCHEMA_UID ?? '') as `0x${string}` | '',
}

/** True when enough is configured to talk to the registry/vault as the oracle. */
export function isOnchainConfigured(): boolean {
  return Boolean(
    onchainEnv.rpcUrl &&
      onchainEnv.oraclePrivateKey &&
      onchainEnv.registryAddress &&
      onchainEnv.vaultAddress,
  )
}

/** True when agents can transact (ZeroDev bundler + agent signer present). */
export function isAgentAccountConfigured(): boolean {
  return Boolean(onchainEnv.zerodevRpc && onchainEnv.agentOwnerPrivateKey && isOnchainConfigured())
}

export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'setLimit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'limit', type: 'uint256' },
      { name: 'score', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'creditLimit',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const VAULT_ABI = [
  { type: 'function', name: 'draw', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'repay', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'available', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'outstanding', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

export const USDC_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

// EAS.attest((bytes32 schema, (address,uint64,bool,bytes32,bytes,uint256)))
export const EAS_ABI = [
  {
    type: 'function',
    name: 'attest',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            name: 'data',
            type: 'tuple',
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'expirationTime', type: 'uint64' },
              { name: 'revocable', type: 'bool' },
              { name: 'refUID', type: 'bytes32' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    outputs: [{ type: 'bytes32' }],
  },
] as const

/** ABI-encoding schema for the credit attestation payload. Register the same
 *  string in the EAS SchemaRegistry to obtain EAS_SCHEMA_UID. */
export const EAS_SCHEMA = 'bytes32 agentId,uint256 creditScore,string rating,uint256 creditLimit,string riskLevel'
