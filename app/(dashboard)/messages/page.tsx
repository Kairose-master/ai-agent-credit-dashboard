'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { MessageSquare, Send, Loader2, UserPlus } from 'lucide-react'
import { getThreads, getMessages, sendMessage, startConversationByEmail, startConversationByUserId } from '@/app/actions/messages'
import { useI18n } from '@/lib/i18n'

type Thread = {
  id: string
  otherUser: { id: string; name: string | null; email: string }
  lastMessage: { body: string; mine: boolean; createdAt: string | Date } | null
  updatedAt: string | Date
}

type Msg = { id: string; body: string; mine: boolean; createdAt: string | Date }

export default function MessagesPage() {
  const { t } = useI18n()
  const searchParams = useSearchParams()
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [startEmail, setStartEmail] = useState('')
  const [startBusy, setStartBusy] = useState(false)

  const listPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async () => {
    const t = await getThreads()
    setThreads(t as Thread[])
    return t as Thread[]
  }, [])

  const loadMessages = useCallback(async (threadId: string) => {
    const m = await getMessages(threadId)
    setMessages(m as Msg[])
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const t = await loadThreads()
        const withParam = searchParams.get('with')
        if (withParam) {
          const { id } = await startConversationByUserId(withParam)
          setActiveId(id)
          await loadMessages(id)
          await loadThreads()
        } else if (t.length > 0) {
          setActiveId(t[0].id)
          await loadMessages(t[0].id)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll thread list every 5s.
  useEffect(() => {
    listPollRef.current = setInterval(() => loadThreads().catch(() => {}), 5000)
    return () => {
      if (listPollRef.current) clearInterval(listPollRef.current)
    }
  }, [loadThreads])

  // Poll active conversation every 2s.
  useEffect(() => {
    if (msgPollRef.current) clearInterval(msgPollRef.current)
    if (!activeId) return
    msgPollRef.current = setInterval(() => loadMessages(activeId).catch(() => {}), 2000)
    return () => {
      if (msgPollRef.current) clearInterval(msgPollRef.current)
    }
  }, [activeId, loadMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const openThread = async (id: string) => {
    setActiveId(id)
    await loadMessages(id)
  }

  const send = async () => {
    if (!activeId || !draft.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      await sendMessage(activeId, draft.trim())
      setDraft('')
      await loadMessages(activeId)
      await loadThreads()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const startNew = async () => {
    setStartBusy(true)
    setError(null)
    try {
      const { id } = await startConversationByEmail(startEmail)
      setStartEmail('')
      await loadThreads()
      await openThread(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStartBusy(false)
    }
  }

  if (loading) return <div className="p-8">{t('msg.loading')}</div>

  const active = threads.find((t) => t.id === activeId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <MessageSquare className="size-7" /> {t('msg.title')}
        </h1>
        <p className="text-muted-foreground mt-1">{t('msg.subtitle')}</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[600px]">
        {/* Thread list */}
        <div className="border border-border rounded-lg flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border flex gap-2">
            <input
              value={startEmail}
              onChange={(e) => setStartEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && startNew()}
              placeholder={t('msg.emailPlaceholder')}
              className="h-9 flex-1 min-w-0 rounded-md border border-border bg-background px-2 text-xs"
              disabled={startBusy}
            />
            <button
              onClick={startNew}
              disabled={startBusy || !startEmail.trim()}
              className="shrink-0 rounded-md border border-border p-2 hover:bg-secondary disabled:opacity-50"
              aria-label={t('msg.startConversation')}
            >
              {startBusy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {t('msg.noConversations')}
              </p>
            )}
            {threads.map((th) => (
              <button
                key={th.id}
                onClick={() => openThread(th.id)}
                className={`w-full text-left p-3 border-b border-border hover:bg-secondary/50 ${
                  th.id === activeId ? 'bg-secondary' : ''
                }`}
              >
                <p className="text-sm font-medium truncate">{th.otherUser.name || th.otherUser.email}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {th.lastMessage
                    ? th.lastMessage.mine
                      ? t('msg.youPrefix', { body: th.lastMessage.body })
                      : th.lastMessage.body
                    : t('msg.noMessagesYet')}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Conversation */}
        <div className="md:col-span-2 border border-border rounded-lg flex flex-col overflow-hidden">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {t('msg.selectConversation')}
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-border">
                <p className="text-sm font-medium">{active.otherUser.name || active.otherUser.email}</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        m.mine ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`text-[10px] mt-1 ${m.mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="p-3 border-t border-border flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder={t('msg.typeMessage')}
                  className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                  disabled={sending}
                />
                <button
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
