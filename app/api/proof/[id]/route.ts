import { getWorkProof } from '@/lib/work-proof-store'
import { verifyWorkProof, trustedAttester } from '@/lib/attestation'
import { gatewayUrl } from '@/lib/ipfs'

/**
 * Public, keyless verification of a Proof of Authorship & Grade.
 *
 *   GET /api/proof/<id>
 *
 * Returns the stored proof, its oracle signature, and a fresh verification:
 * the signature is recovered and checked against the platform's trusted
 * attester (the self-attestation defense). Anyone can re-run this — the proof
 * is signed data, not a claim we ask you to trust.
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  const stored = await getWorkProof(id)
  if (!stored) return Response.json({ error: 'proof not found' }, { status: 404 })

  const verification = await verifyWorkProof(stored.proof, stored.signature as `0x${string}`, stored.attester as `0x${string}`)
  const trusted = trustedAttester()
  return Response.json({
    id: stored.id,
    proof: stored.proof,
    signature: stored.signature,
    attester: stored.attester,
    trustedAttester: trusted,
    ipfs: stored.cid ? { cid: stored.cid, uri: `ipfs://${stored.cid}`, gateway: gatewayUrl(stored.cid) } : null,
    verification: {
      signatureValid: verification.recovered.toLowerCase() === stored.attester.toLowerCase(),
      recovered: verification.recovered,
      // attester is the platform oracle → not a worker forging its own pass
      attesterIsTrusted: !!trusted && stored.attester.toLowerCase() === trusted.toLowerCase(),
    },
  })
}
