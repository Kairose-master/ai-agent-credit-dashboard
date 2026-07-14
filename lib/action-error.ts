/**
 * Server actions that touch the on-chain layer must never let a raw
 * exception escape uncaught — Next.js redacts unhandled server errors in
 * production ("The specific message is omitted..."), which makes on-chain
 * failures (bad RPC, paymaster rejection, insufficient gas policy, bad key)
 * impossible for users or us to diagnose. Wrap the risky call and rethrow a
 * controlled Error so the real (safe) message reaches the client.
 */
export function asActionError(error: unknown, context: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[${context}]`, error)
  return new Error(`${context}: ${message}`)
}
