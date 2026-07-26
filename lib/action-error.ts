import { explainOnchainError } from '@/lib/onchain/errors'

/**
 * Server actions that touch the on-chain layer must never let a raw
 * exception escape uncaught — Next.js redacts unhandled server errors in
 * production ("The specific message is omitted..."), which makes on-chain
 * failures (bad RPC, paymaster rejection, insufficient gas policy, bad key)
 * impossible for users or us to diagnose. Wrap the risky call and rethrow a
 * controlled Error so the real (safe) message reaches the client.
 */
export function asActionError(error: unknown, context: string): Error {
  console.error(`[${context}]`, error)
  // The full error (multi-KB UserOperation dumps included) is in the server
  // log above; what reaches the user is the one sentence they can act on.
  return new Error(`${context}: ${explainOnchainError(error)}`)
}
