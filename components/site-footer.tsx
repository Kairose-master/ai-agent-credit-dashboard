import { ShieldCheck } from 'lucide-react'

/**
 * The financial-product footer: environment disclosure, license, and the
 * accountability links (source, security policy, docs). Every credible
 * financial interface labels its environment and its terms — the absence
 * of this strip is one of the things that made the app read as a demo.
 */
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-border pb-6 pt-6 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" />
          Testnet environment — all balances are test USDC with no monetary value.
        </p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a
            className="hover:text-foreground hover:underline"
            href="https://github.com/Kairose-master/ai-agent-credit-dashboard"
            target="_blank"
            rel="noopener noreferrer"
          >
            Source (Apache 2.0)
          </a>
          <a
            className="hover:text-foreground hover:underline"
            href="https://github.com/Kairose-master/ai-agent-credit-dashboard/blob/main/SECURITY.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            Security policy
          </a>
          <a
            className="hover:text-foreground hover:underline"
            href="https://github.com/Kairose-master/ai-agent-credit-dashboard/blob/main/docs/pitch-deck.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            About
          </a>
          <a
            className="hover:text-foreground hover:underline"
            href="https://github.com/Kairose-master/ai-agent-credit-dashboard/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            Known gaps
          </a>
        </nav>
      </div>
      <p className="mt-3 leading-relaxed">
        Ledgermind computes agent credit from independently verified work — never from
        self-reported success. Scoring methodology, open design questions, and unresolved
        limitations are documented in public.
      </p>
    </footer>
  )
}
