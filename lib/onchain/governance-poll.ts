/**
 * On-chain commit-reveal governance — the GovernancePoll registry.
 *
 * Gated behind isGovernanceOnchainConfigured(): with GOVERNANCE_POLL_ADDRESS
 * unset, none of this runs and governance is purely off-chain. When set, a
 * proposal mirrors to an on-chain poll and confident delegate votes are also
 * committed then revealed on-chain, via each agent's own smart account (the
 * platform is already the authorized signer behind those accounts, so no
 * session-key handshake is needed — unlike a user-wallet design).
 *
 * The on-chain record is one-address-one-CHOICE; ve-weight is applied
 * off-chain. Every function here is best-effort and must never break the
 * off-chain path that calls it.
 */
import { encodeFunctionData, encodePacked, keccak256, toHex, type Address, type Hex } from 'viem'
import { onchainEnv, isGovernanceOnchainConfigured } from './config'
import { publicClient } from './clients'
import { sendAgentCall, getAgentAccountAddress } from './account'

export const GOVERNANCE_POLL_ABI = [
  {
    type: 'function',
    name: 'createPoll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'numOptions', type: 'uint8' },
      { name: 'commitEnd', type: 'uint64' },
      { name: 'revealEnd', type: 'uint64' },
    ],
    outputs: [{ name: 'pollId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'commitVote',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pollId', type: 'uint256' },
      { name: 'commitment', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revealVote',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pollId', type: 'uint256' },
      { name: 'option', type: 'uint8' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'pollCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'phase',
    stateMutability: 'view',
    inputs: [{ name: 'pollId', type: 'uint256' }],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'results',
    stateMutability: 'view',
    inputs: [{ name: 'pollId', type: 'uint256' }],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    type: 'event',
    name: 'PollCreated',
    inputs: [
      { name: 'pollId', type: 'uint256', indexed: true },
      { name: 'numOptions', type: 'uint8', indexed: false },
      { name: 'commitEnd', type: 'uint64', indexed: false },
      { name: 'revealEnd', type: 'uint64', indexed: false },
    ],
  },
] as const

/** for → 0, against → 1, abstain → 2 (must match the off-chain choices). */
export const CHOICE_TO_OPTION = { for: 0, against: 1, abstain: 2 } as const
export const NUM_OPTIONS = 3

function pollAddress(): Address {
  return onchainEnv.governancePollAddress as Address
}

/** Fresh 32-byte salt as a hex string (stored encrypted until reveal). */
export function newSalt(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes, { size: 32 })
}

/** commitment = keccak256(abi.encodePacked(uint256(option), salt, voter)). */
export function computeCommitment(option: number, salt: Hex, voter: Address): Hex {
  return keccak256(encodePacked(['uint256', 'bytes32', 'address'], [BigInt(option), salt, voter]))
}

/**
 * Create an on-chain poll for a proposal. commitEnd = proposal close,
 * revealEnd = close + reveal window. Returns the new pollId, or null if
 * off/failed. The pollId is read back from pollCount right after (the tx is
 * sequential from one relayer, so pollCount is the id we just created).
 */
export async function createOnchainPoll(
  creatorAgentId: string,
  commitEndSec: number,
  revealEndSec: number,
): Promise<number | null> {
  if (!isGovernanceOnchainConfigured()) return null
  try {
    const data = encodeFunctionData({
      abi: GOVERNANCE_POLL_ABI,
      functionName: 'createPoll',
      args: [NUM_OPTIONS, BigInt(commitEndSec), BigInt(revealEndSec)],
    })
    await sendAgentCall(creatorAgentId, { to: pollAddress(), data })
    const count = await publicClient().readContract({
      address: pollAddress(),
      abi: GOVERNANCE_POLL_ABI,
      functionName: 'pollCount',
    })
    return Number(count)
  } catch (error) {
    console.error('[governance-poll] createOnchainPoll failed (non-fatal):', error)
    return null
  }
}

/** Commit a hidden vote from an agent's smart account. Returns {salt, txHash}
 *  on success (caller stores the salt, encrypted, for the reveal). */
export async function commitOnchainVote(
  agentId: string,
  pollId: number,
  option: number,
): Promise<{ salt: Hex; txHash: Hex } | null> {
  if (!isGovernanceOnchainConfigured()) return null
  try {
    const voter = await getAgentAccountAddress(agentId)
    const salt = newSalt()
    const commitment = computeCommitment(option, salt, voter)
    const data = encodeFunctionData({
      abi: GOVERNANCE_POLL_ABI,
      functionName: 'commitVote',
      args: [BigInt(pollId), commitment],
    })
    const txHash = await sendAgentCall(agentId, { to: pollAddress(), data })
    return { salt, txHash }
  } catch (error) {
    console.error('[governance-poll] commitOnchainVote failed (non-fatal):', error)
    return null
  }
}

/** Reveal a previously committed vote during the reveal window. */
export async function revealOnchainVote(
  agentId: string,
  pollId: number,
  option: number,
  salt: Hex,
): Promise<Hex | null> {
  if (!isGovernanceOnchainConfigured()) return null
  try {
    const data = encodeFunctionData({
      abi: GOVERNANCE_POLL_ABI,
      functionName: 'revealVote',
      args: [BigInt(pollId), option, salt],
    })
    return await sendAgentCall(agentId, { to: pollAddress(), data })
  } catch (error) {
    console.error('[governance-poll] revealOnchainVote failed (non-fatal):', error)
    return null
  }
}

/** On-chain phase: 0 commit, 1 reveal, 2 closed, 255 missing, null if off. */
export async function pollPhase(pollId: number): Promise<number | null> {
  if (!isGovernanceOnchainConfigured()) return null
  try {
    const phase = await publicClient().readContract({
      address: pollAddress(),
      abi: GOVERNANCE_POLL_ABI,
      functionName: 'phase',
      args: [BigInt(pollId)],
    })
    return Number(phase)
  } catch {
    return null
  }
}
