'use client'

import { useEffect, useState } from 'react'
import { getApiKeyStatus, saveAnthropicKey, removeAnthropicKey } from '@/app/actions/settings'
import { updateDisplayName, changePassword } from '@/app/actions/account'
import { useI18n } from '@/lib/i18n'

export default function SettingsPage() {
  const { t } = useI18n()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [keyInput, setKeyInput] = useState('')
  const [keyHint, setKeyHint] = useState<string | null>(null)
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyMsg, setKeyMsg] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const me = await fetch('/api/me')
        if (me.ok) setUser((await me.json()).user)
        const status = await getApiKeyStatus()
        setKeyHint(status.hasKey ? status.hint : null)
      } catch (error) {
        console.error('[v0] Error:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const saveKey = async () => {
    setKeyBusy(true)
    setKeyMsg(null)
    try {
      const { hint } = await saveAnthropicKey(keyInput)
      setKeyHint(hint)
      setKeyInput('')
      setKeyMsg(t('settings.byok.savedMsg'))
    } catch (e) {
      setKeyMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setKeyBusy(false)
    }
  }

  const removeKey = async () => {
    setKeyBusy(true)
    setKeyMsg(null)
    try {
      await removeAnthropicKey()
      setKeyHint(null)
      setKeyMsg(t('settings.byok.removedMsg'))
    } catch (e) {
      setKeyMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setKeyBusy(false)
    }
  }

  if (loading) return <div className="p-8">{t('settings.loading')}</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
        <p className="text-muted-foreground">{t('settings.subtitle')}</p>
      </div>

      <AccountCard initialName={user?.name ?? ''} email={user?.email ?? ''} />

      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-1">{t('settings.byok.title')}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {t('settings.byok.descBeforeLink')}{' '}
          <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            console.anthropic.com
          </a>{' '}
          {t('settings.byok.descAfterLink')}
        </p>

        {keyHint ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-success/15 px-3 py-1.5 text-sm font-mono text-success">
              {t('settings.byok.activeKey', { hint: keyHint })}
            </span>
            <button
              onClick={removeKey}
              disabled={keyBusy}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
            >
              {t('settings.byok.removeKey')}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-…"
              className="h-9 w-full max-w-md rounded-md border border-border bg-background px-3 font-mono text-sm"
              autoComplete="off"
            />
            <button
              onClick={saveKey}
              disabled={keyBusy || !keyInput.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {keyBusy ? t('settings.byok.saving') : t('settings.byok.saveKey')}
            </button>
          </div>
        )}
        {keyMsg && <p className="mt-3 text-sm text-muted-foreground">{keyMsg}</p>}
      </div>
    </div>
  )
}

function AccountCard({ initialName, email }: { initialName: string; email: string }) {
  const { t } = useI18n()
  const [name, setName] = useState(initialName)
  const [savedName, setSavedName] = useState(initialName)
  const [nameBusy, setNameBusy] = useState(false)
  const [nameMsg, setNameMsg] = useState<string | null>(null)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)

  useEffect(() => {
    setName(initialName)
    setSavedName(initialName)
  }, [initialName])

  const saveName = async () => {
    setNameBusy(true)
    setNameMsg(null)
    try {
      const { name: saved } = await updateDisplayName(name)
      setSavedName(saved)
      setNameMsg(t('settings.account.savedMsg'))
    } catch (e) {
      setNameMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setNameBusy(false)
    }
  }

  const savePassword = async () => {
    setPwBusy(true)
    setPwMsg(null)
    try {
      await changePassword(currentPw, newPw)
      setCurrentPw('')
      setNewPw('')
      setPwMsg(t('settings.account.passwordChangedMsg'))
    } catch (e) {
      setPwMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div className="border border-border rounded-lg p-6">
      <h3 className="font-bold text-lg mb-4">{t('settings.account.title')}</h3>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{t('settings.account.displayName')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full max-w-xs rounded-md border border-border bg-background px-3 text-sm"
              maxLength={60}
            />
            <button
              onClick={saveName}
              disabled={nameBusy || !name.trim() || name.trim() === savedName}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
            >
              {nameBusy ? t('settings.account.saving') : t('settings.account.save')}
            </button>
            {nameMsg && <span className="text-sm text-muted-foreground">{nameMsg}</span>}
          </div>
        </div>

        <div>
          <p className="text-sm text-muted-foreground mb-1">{t('settings.account.emailLabel')}</p>
          <p className="font-mono text-sm">{email}</p>
        </div>

        <div>
          <p className="text-sm text-muted-foreground mb-2">{t('settings.account.changePassword')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder={t('settings.account.currentPasswordPlaceholder')}
              autoComplete="current-password"
              className="h-9 w-full max-w-[200px] rounded-md border border-border bg-background px-3 text-sm"
            />
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder={t('settings.account.newPasswordPlaceholder')}
              autoComplete="new-password"
              className="h-9 w-full max-w-[200px] rounded-md border border-border bg-background px-3 text-sm"
            />
            <button
              onClick={savePassword}
              disabled={pwBusy || !currentPw || newPw.length < 8}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {pwBusy ? t('settings.account.changing') : t('settings.account.changePassword')}
            </button>
          </div>
          {pwMsg && <p className="mt-2 text-sm text-muted-foreground">{pwMsg}</p>}
        </div>
      </div>
    </div>
  )
}
