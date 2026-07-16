'use client'

import { ShieldCheck } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

/**
 * The financial-product footer: environment disclosure, license, and the
 * accountability links (source, security policy, docs). Every credible
 * financial interface labels its environment and its terms — the absence
 * of this strip is one of the things that made the app read as a demo.
 */
export function SiteFooter() {
  const { t } = useI18n()
  return (
    <footer className="mt-12 border-t border-border pb-6 pt-6 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" />
          {t('footer.testnetNotice')}
        </p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a
            className="hover:text-foreground hover:underline"
            href="https://github.com/Kairose-master/ai-agent-credit-dashboard"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('footer.source')}
          </a>
          <a
            className="hover:text-foreground hover:underline"
            href="https://github.com/Kairose-master/ai-agent-credit-dashboard/blob/main/SECURITY.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('footer.securityPolicy')}
          </a>
          <a
            className="hover:text-foreground hover:underline"
            href="https://github.com/Kairose-master/ai-agent-credit-dashboard/blob/main/docs/pitch-deck.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('footer.about')}
          </a>
          <a
            className="hover:text-foreground hover:underline"
            href="https://github.com/Kairose-master/ai-agent-credit-dashboard/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('footer.knownGaps')}
          </a>
        </nav>
      </div>
      <p className="mt-3 leading-relaxed">
        {t('footer.tagline')}
      </p>
    </footer>
  )
}
