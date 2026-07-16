'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen,
  Bot,
  KeyRound,
  Link2,
  Play,
  Pickaxe,
  Zap,
  Briefcase,
  Fingerprint,
  CheckCircle2,
  Circle,
  ChevronDown,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react'
import { getGuideProgress } from '@/app/actions/guide'
import { useI18n } from '@/lib/i18n'

type Progress = Awaited<ReturnType<typeof getGuideProgress>>

/**
 * The guide is a LIVE checklist: every step's done-state is a real query
 * (see getGuideProgress), so it checks itself off as the account actually
 * does things. Text lives in the i18n dictionaries (EN/KO/ZH).
 */
const STEPS: {
  key: string
  icon: typeof Bot
  href: string
  doneWhen: (p: Progress) => boolean
  optional?: boolean
}[] = [
  { key: 's1', icon: Bot, href: '/', doneWhen: (p) => p.hasAgent },
  { key: 's2', icon: KeyRound, href: '/settings', doneWhen: (p) => p.hasApiKey, optional: true },
  { key: 's3', icon: Link2, href: '/profile', doneWhen: (p) => p.hasProvisioned },
  { key: 's4', icon: Play, href: '/profile', doneWhen: (p) => p.hasRunTask },
  { key: 's5', icon: Pickaxe, href: '/mine', doneWhen: (p) => p.hasLocalWorker },
  { key: 's6', icon: Zap, href: '/mine', doneWhen: (p) => p.hasAutoMine },
  { key: 's7', icon: Briefcase, href: '/jobs', doneWhen: (p) => p.hasCompletedJob },
  { key: 's8', icon: Fingerprint, href: '/profile', doneWhen: (p) => p.hasErc8004 },
]

export default function GuidePage() {
  const { t } = useI18n()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => getGuideProgress().then((p) => !cancelled && setProgress(p)).catch(() => {})
    load()
    const timer = setInterval(load, 8000) // steps check themselves off live
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const doneCount = progress ? STEPS.filter((s) => s.doneWhen(progress)).length : 0
  const firstOpen = progress ? STEPS.find((s) => !s.doneWhen(progress))?.key ?? null : null
  const expanded = open ?? firstOpen

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BookOpen className="size-7" /> {t('guide.title')}
        </h1>
        <p className="text-muted-foreground mt-1">{t('guide.subtitle')}</p>
      </div>

      {/* Progress bar — fills as the account really progresses */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">
            {doneCount}/{STEPS.length} {t('guide.progress')}
          </span>
          <span className="font-mono text-muted-foreground">{Math.round((doneCount / STEPS.length) * 100)}%</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-all duration-700"
            style={{ width: `${(doneCount / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-2">
        {STEPS.map((step, i) => {
          const done = progress ? step.doneWhen(progress) : false
          const isOpen = expanded === step.key
          const Icon = step.icon
          return (
            <div
              key={step.key}
              className={`rounded-lg border transition-colors ${
                done ? 'border-success/30 bg-success/5' : 'border-border'
              }`}
            >
              <button
                onClick={() => setOpen(isOpen ? '' : step.key)}
                className="flex w-full items-center gap-3 p-4 text-left"
              >
                {done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted-foreground" />
                )}
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className={`flex-1 font-medium ${done ? 'text-muted-foreground line-through decoration-success/40' : ''}`}>
                  {i + 1}. {t(`guide.${step.key}.title`)}
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    done ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {done ? t('guide.done') : t('guide.todo')}
                </span>
                <ChevronDown
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isOpen && (
                <div className="border-t border-border/60 px-4 pb-4 pt-3 pl-12">
                  <p className="text-sm text-muted-foreground">{t(`guide.${step.key}.desc`)}</p>
                  {!done && (
                    <Link
                      href={step.href}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      {t(`guide.${step.key}.cta`)} <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-primary" /> {t('guide.trust.title')}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{t('guide.trust.body')}</p>
      </div>
    </div>
  )
}
