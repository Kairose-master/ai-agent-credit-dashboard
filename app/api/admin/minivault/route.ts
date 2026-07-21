import { deployMiniVault, demoDepositAndMint, readMiniVaultPosition, readMiniVaultState, setMiniVaultPrice } from '@/lib/onchain/mini-vault-chain'
import { oracleAccount } from '@/lib/onchain/clients'

/**
 * MiniVault ops — deploy and drive the on-chain GIWA engine with the platform
 * oracle wallet. Guarded by CRON_SECRET.
 *
 *   POST /api/admin/minivault?secret=…&action=deploy[&price=3000][&force=1]
 *   POST …&action=set-price&price=1200        (Oracle Mock price push)
 *   POST …&action=demo[&eth=0.002]            (deposit + mint half of max)
 *   POST …&action=read                        (state + oracle position)
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const url = new URL(request.url)
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('secret') ?? ''
  if (given !== secret) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const action = url.searchParams.get('action') ?? 'read'
  try {
    if (action === 'deploy') {
      const price = Number(url.searchParams.get('price') ?? 3000)
      const force = url.searchParams.get('force') === '1'
      const { address, txHash } = await deployMiniVault(price, force)
      return Response.json({ status: 'ok', action, address, txHash, initialPriceUsd: price })
    }
    if (action === 'set-price') {
      const price = Number(url.searchParams.get('price'))
      if (!Number.isFinite(price) || price <= 0) return Response.json({ error: 'price required' }, { status: 400 })
      const txHash = await setMiniVaultPrice(price)
      return Response.json({ status: 'ok', action, priceUsd: price, txHash })
    }
    if (action === 'demo') {
      const eth = Number(url.searchParams.get('eth') ?? 0.002)
      const result = await demoDepositAndMint(eth)
      const position = await readMiniVaultPosition(oracleAccount().address)
      return Response.json({ status: 'ok', action, depositedEth: eth, ...result, position })
    }
    // read
    const state = await readMiniVaultState()
    if (!state) return Response.json({ status: 'ok', action, deployed: false })
    const position = await readMiniVaultPosition(oracleAccount().address)
    return Response.json({ status: 'ok', action, deployed: true, state, oraclePosition: position })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
