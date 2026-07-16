'use client'

import { useI18n } from '@/lib/i18n'

export default function RiskPage() {
  const { t } = useI18n()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('risk.title')}</h1>
        <p className="text-muted-foreground">{t('risk.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">{t('risk.defaultProbability')}</p>
          <p className="text-3xl font-bold mt-2">2.3%</p>
          <p className="text-xs text-muted-foreground mt-1">{t('risk.avgAcrossAgents')}</p>
        </div>
        <div className="p-4 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">{t('risk.totalExposure')}</p>
          <p className="text-3xl font-bold mt-2">$1.2M</p>
          <p className="text-xs text-muted-foreground mt-1">{t('risk.activeCreditLines')}</p>
        </div>
        <div className="p-4 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">{t('risk.aaaRated')}</p>
          <p className="text-3xl font-bold mt-2">45%</p>
          <p className="text-xs text-muted-foreground mt-1">{t('risk.portfolioComposition')}</p>
        </div>
        <div className="p-4 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">{t('risk.var95')}</p>
          <p className="text-3xl font-bold mt-2">$28K</p>
          <p className="text-xs text-muted-foreground mt-1">{t('risk.valueAtRisk')}</p>
        </div>
      </div>

      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-4">{t('risk.distributionTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('risk.distributionSubtitle')}</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
          {['AAA', 'AA', 'A', 'BBB', 'BB'].map((rating) => (
            <div key={rating} className="p-3 bg-secondary/50 rounded text-center">
              <p className="font-bold">{rating}</p>
              <p className="text-xs text-muted-foreground mt-1">{Math.round(Math.random() * 20)}%</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
