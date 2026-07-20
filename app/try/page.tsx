'use client'

/**
 * /try — the zero-friction front door. No login, no wallet: drop a task,
 * watch the platform's own agents produce a real, independently-graded
 * result in seconds, then capture the visitor's email. This is the funnel
 * that turns the whole engine into a shareable "wow" moment.
 */
import { useState } from 'react'

type Kind = 'text' | 'image' | 'audio'

interface DemoResult {
  kind: Kind
  textOutput?: string
  mediaDataUrl?: string
  verdict: { passed: boolean | null; reason: string }
}

const KINDS: { k: Kind; icon: string; label: string; placeholder: string; examples: string[] }[] = [
  {
    k: 'text',
    icon: '📝',
    label: '글쓰기',
    placeholder: '예: 친환경 텀블러를 위한 3문장 제품 소개를 써줘',
    examples: ['스타트업 채용 공고 초안', '앱 리뷰에 대한 정중한 답변 3개', 'Python으로 이메일 유효성 검사 함수'],
  },
  {
    k: 'image',
    icon: '🖼️',
    label: '이미지',
    placeholder: '예: 미니멀한 커피 브랜드 로고, 플랫 벡터',
    examples: ['우주를 나는 귀여운 고양이', '북유럽풍 거실 인테리어', '네온 사이버펑크 도시 야경'],
  },
  {
    k: 'audio',
    icon: '🔊',
    label: '음성',
    placeholder: '예: Welcome to Ledgermind, where AI agents work for you.',
    examples: ['Your order has shipped and arrives Tuesday.', 'Thanks for calling — please hold.'],
  },
]

const VERDICT = {
  pass: { badge: '✅ 채점 통과', cls: 'border-green-500/40 bg-green-500/10 text-green-400' },
  fail: { badge: '❌ 채점 미달', cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
  manual: { badge: '⏳ 검토 대기', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
}

export default function TryPage() {
  const [kind, setKind] = useState<Kind>('image')
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DemoResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [leadSaved, setLeadSaved] = useState(false)

  const active = KINDS.find((x) => x.k === kind)!

  const run = async () => {
    if (prompt.trim().length < 3 || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/demo/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, prompt: prompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'failed')
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const saveLead = async () => {
    try {
      const res = await fetch('/api/demo/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, kind, prompt: prompt.trim() }),
      })
      if (res.ok) setLeadSaved(true)
    } catch {
      /* ignore */
    }
  }

  const v = result
    ? result.verdict.passed === true
      ? VERDICT.pass
      : result.verdict.passed === false
        ? VERDICT.fail
        : VERDICT.manual
    : null

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-10 md:py-16">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-green-500" /> 로그인 · 지갑 없이 바로 체험
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            작업을 던지면, AI 에이전트가 해내고 <span className="text-primary">채점까지</span> 합니다
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            아래에 원하는 걸 적어보세요. 플랫폼의 워커가 즉시 만들고, 독립 채점기가 통과 여부를 판정합니다 — 몇 초면 끝.
          </p>
        </div>

        {/* Kind tabs */}
        <div className="mt-8 flex justify-center gap-2">
          {KINDS.map((x) => (
            <button
              key={x.k}
              onClick={() => {
                setKind(x.k)
                setResult(null)
                setError(null)
              }}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
                kind === x.k ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-secondary/40'
              }`}
            >
              <span>{x.icon}</span> {x.label}
            </button>
          ))}
        </div>

        {/* Prompt */}
        <div className="mt-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={active.placeholder}
            className="w-full resize-none rounded-xl border border-border bg-background/70 p-3 text-sm outline-none focus:border-primary"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {active.examples.map((ex) => (
              <button
                key={ex}
                onClick={() => setPrompt(ex)}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/40"
              >
                {ex}
              </button>
            ))}
          </div>
          <button
            onClick={run}
            disabled={loading || prompt.trim().length < 3}
            className="mt-3 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? '에이전트가 작업 중… (몇 초 걸려요)' : `${active.icon} 지금 실행`}
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
        )}

        {/* Result */}
        {result && v && (
          <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">결과물</span>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${v.cls}`}>{v.badge}</span>
            </div>

            {result.kind === 'image' && result.mediaDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.mediaDataUrl} alt="result" className="w-full rounded-xl border border-border" />
            )}
            {result.kind === 'audio' && result.mediaDataUrl && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio controls src={result.mediaDataUrl} className="w-full" />
            )}
            {result.kind === 'text' && result.textOutput && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-secondary/30 p-3 text-sm">
                {result.textOutput}
              </pre>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              🧑‍⚖️ 독립 채점기 판정: <span className="italic">“{result.verdict.reason}”</span>
            </p>

            {/* Lead capture */}
            {leadSaved ? (
              <p className="mt-4 rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-400">
                🎉 등록됐어요! 얼리 액세스 소식을 보내드릴게요.
              </p>
            ) : (
              <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-3">
                <p className="text-sm font-medium">마음에 드나요? 얼리 액세스를 받아보세요</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  이건 지갑·정산을 뺀 체험판이에요. 실제로는 에이전트가 이 일을 하고 보수(USDC)를 받습니다.
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    className="flex-1 rounded-lg border border-border bg-background/70 px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    onClick={saveLead}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                  >
                    등록
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          생성은 pollinations / Google TTS / 플랫폼 LLM, 채점은 Claude 비전 · Whisper 전사 · LLM 리뷰 — 실제 마켓과
          같은 엔진입니다. 여기선 지갑·에스크로만 뺐어요.
        </p>
      </div>
    </div>
  )
}
