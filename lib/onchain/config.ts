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
  laborMarketAddress: (process.env.LABOR_MARKET_ADDRESS ?? '') as `0x${string}` | '',
  verifiedEscrowAddress: (process.env.VERIFIED_TASK_ESCROW_ADDRESS ?? '') as `0x${string}` | '',
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

/** True when the on-chain labor market is available. */
export function isLaborMarketConfigured(): boolean {
  return Boolean(onchainEnv.laborMarketAddress && isAgentAccountConfigured())
}

/** True when the verified-task escrow is available. */
export function isVerifiedEscrowConfigured(): boolean {
  return Boolean(onchainEnv.verifiedEscrowAddress && isAgentAccountConfigured())
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

export const LABOR_MARKET_ABI = [
  { type: 'function', name: 'postJob', stateMutability: 'nonpayable', inputs: [{ name: 'bounty', type: 'uint256' }, { name: 'minScore', type: 'uint256' }, { name: 'specHash', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'acceptJob', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'submitWork', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'resultHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'approveJob', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'cancelJob', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'raiseDispute', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'resolveDispute', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'releaseToWorker', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'arbiter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'jobCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'jobs',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [
      { name: 'requester', type: 'address' },
      { name: 'worker', type: 'address' },
      { name: 'bounty', type: 'uint256' },
      { name: 'minScore', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'specHash', type: 'bytes32' },
      { name: 'resultHash', type: 'bytes32' },
    ],
  },
] as const

export const JOB_STATUS = ['Open', 'Accepted', 'Submitted', 'Completed', 'Cancelled', 'Disputed', 'Refunded'] as const
export type JobStatus = (typeof JOB_STATUS)[number]

export const VERIFIED_ESCROW_ABI = [
  { type: 'function', name: 'postTask', stateMutability: 'nonpayable', inputs: [{ name: 'bounty', type: 'uint256' }, { name: 'minScore', type: 'uint256' }, { name: 'specHash', type: 'bytes32' }, { name: 'answerHash', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'commitAnswer', stateMutability: 'nonpayable', inputs: [{ name: 'taskId', type: 'uint256' }, { name: 'commitment', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'revealAnswer', stateMutability: 'nonpayable', inputs: [{ name: 'taskId', type: 'uint256' }, { name: 'answer', type: 'string' }, { name: 'salt', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'cancelTask', stateMutability: 'nonpayable', inputs: [{ name: 'taskId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'taskCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'tasks',
    stateMutability: 'view',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [
      { name: 'requester', type: 'address' },
      { name: 'solver', type: 'address' },
      { name: 'bounty', type: 'uint256' },
      { name: 'minScore', type: 'uint256' },
      { name: 'specHash', type: 'bytes32' },
      { name: 'answerHash', type: 'bytes32' },
      { name: 'commitment', type: 'bytes32' },
      { name: 'revealDeadline', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ],
  },
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
