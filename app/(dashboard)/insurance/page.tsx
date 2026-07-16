'use client'

import { useI18n } from '@/lib/i18n'

export default function InsurancePage() {
  const { t } = useI18n()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('ins.title')}</h1>
        <p className="text-muted-foreground">{t('ins.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-2">{t('ins.poolTitle')}</h3>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">{t('ins.capital')}</span> $8.4M</p>
            <p><span className="text-muted-foreground">{t('ins.utilization')}</span> 42%</p>
            <p><span className="text-muted-foreground">{t('ins.apy')}</span> 9.2%</p>
            <p><span className="text-muted-foreground">{t('ins.underwriters')}</span> 214</p>
          </div>
        </div>

        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-2">{t('ins.yourCoverage')}</h3>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">{t('ins.coverageAmount')}</span> $500K</p>
            <p><span className="text-muted-foreground">{t('ins.premium')}</span> {t('ins.premiumValue', { amount: '$4,200' })}</p>
            <p><span className="text-muted-foreground">{t('ins.status')}</span> <span className="text-success">{t('ins.active')}</span></p>
            <p><span className="text-muted-foreground">{t('ins.renewal')}</span> Dec 31, 2024</p>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-4">{t('ins.productsTitle')}</h3>
        <div className="space-y-3">
          {['ins.productDefaultCoverage', 'ins.productOperationalRisk', 'ins.productLiquidationProtection', 'ins.productSmartContractInsurance'].map((product) => (
            <div key={product} className="flex items-center justify-between p-3 bg-secondary/50 rounded">
              <span className="font-medium">{t(product)}</span>
              <button className="text-xs px-3 py-1 rounded border border-border hover:bg-secondary">
                {t('ins.learnMore')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
