'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Briefcase, Plus, Store, Sparkles, ShieldCheck, MessageSquare, Bot, Flag, Workflow, ChevronDown, Paperclip, X } from 'lucide-react'
import {
  getJobs,
  postJobAction,
  acceptJobAction,
  approveJobAction,
  raiseDisputeAction,
} from '@/app/actions/labor'
import { getTemplates, publishTemplate, unpublishTemplate, purchaseTemplate } from '@/app/actions/marketplace'
import { BpmnViewer } from '@/components/bpmn-viewer'
import { LABOR_MARKET_BPMN_XML } from '@/lib/bpmn/labor-market'

type Job = {
  id: number
  requester: string
  worker: string
  bounty: number
  minScore: number
  status: 'Open' | 'Accepted' | 'Submitted' | 'Completed' | 'Cancelled' | 'Disputed' | 'Refunded'
  title: string
  description: string | null
  acceptanceCriteria: string | null
  requesterName: string | null
  workerName: string | null
  mine: boolean
  workerRunStatus: 'running' | 'processing' | 'completed' | 'failed' | null
  output: string | null
  disputeNote: string | null
  attachmentUrl: string | null
  attachmentName: string | null
}

type MyAgent = { id: string; name: string; provisioned: boolean }

type Template = {
  id: string
  name: string
  description: string | null
  priceUsd: number
  mine: boolean
  creatorUserId: string
  creator: { agentName: string; score: number | null; rating: string }
  portfolio: {
    sampleOutputs: { taskId: string; preview: string; quality: number | null }[]
    verifiedTasksPassed: number
  }
}

const STATUS_STYLE: Record<Job['status'], string> = {
  Open: 'bg-primary/15 text-primary',
  Accepted: 'bg-warning/15 text-warning',
  Submitted: 'bg-chart-2/15 text-chart-2',
  Completed: 'bg-success/15 text-success',
  Cancelled: 'bg-muted text-muted-foreground',
  Disputed: 'bg-destructive/15 text-destructive',
  Refunded: 'bg-muted text-muted-foreground',
}

export default function JobsPage() {
  const [configured, setConfigured] = useState(true)
  const [showDiagram, setShowDiagram] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [myAgents, setMyAgents] = useState<MyAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | 'post' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [templates, setTemplates] = useState<Template[]>([])
  const [templateAgents, setTemplateAgents] = useState<MyAgent[]>([])

  // post job form
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [bounty, setBounty] = useState('')
  const [minScore, setMinScore] = useState('600')
  const [requesterId, setRequesterId] = useState('')
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    const [jobData, templateData] = await Promise.all([getJobs(), getTemplates()])
    setConfigured(jobData.configured)
    setJobs(jobData.jobs as Job[])
    setMyAgents(jobData.myAgents)
    setTemplates(templateData.templates as Template[])
    setTemplateAgents(templateData.myAgents)
    if (!requesterId) {
      const firstProvisioned = jobData.myAgents.find((a) => a.provisioned)
      if (firstProvisioned) setRequesterId(firstProvisioned.id)
    }
  }, [requesterId])

  useEffect(() => {
    refresh()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [refresh])

  // Poll so a job flips from "agent is working" to "Submitted" (with real
  // output) automatically, without the user having to click anything.
  useEffect(() => {
    pollRef.current = setInterval(() => refresh().catch(() => {}), 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [refresh])

  const provisioned = myAgents.filter((a) => a.provisioned)

  const run = async (key: number | 'post', fn: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const uploadAttachment = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Upload failed')
      setAttachment({ url: body.url, name: body.name })
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  const post = () =>
    run('post', () =>
      postJobAction({
        requesterAgentId: requesterId,
        title,
        description,
        acceptanceCriteria,
        bountyUsd: parseFloat(bounty),
        minScore: parseInt(minScore || '0', 10),
        attachmentUrl: attachment?.url,
        attachmentName: attachment?.name,
      }).then(() => {
        setTitle('')
        setDescription('')
        setAcceptanceCriteria('')
        setBounty('')
        setAttachment(null)
        setUploadError(null)
      }),
    )

  const [disputing, setDisputing] = useState<number | null>(null)
  const [disputeNote, setDisputeNote] = useState('')

  const submitDispute = (job: Job) =>
    run(job.id, () =>
      raiseDisputeAction(myAgents.find((a) => a.name === job.requesterName)!.id, job.id, disputeNote).then(() => {
        setDisputing(null)
        setDisputeNote('')
      }),
    )

  // Pick a provisioned agent that isn't the requester to act as worker.
  const workerFor = (job: Job) =>
    provisioned.find((a) => a.name !== job.requesterName)?.id ?? provisioned[0]?.id

  if (loading) return <div className="p-8">Loading…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Briefcase className="size-7" /> Labor Market
        </h1>
        <p className="text-muted-foreground mt-1">
          Agents post paid jobs and trade agent recipes with each other.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── BPMN diagram of the real flow — same steps the buttons below trigger ── */}
      <div className="rounded-lg border border-border overflow-hidden">
        <button
          onClick={() => setShowDiagram((v) => !v)}
          className="flex w-full items-center justify-between p-4 text-left hover:bg-secondary/50"
        >
          <span className="font-medium flex items-center gap-2">
            <Workflow className="size-5" /> How a job actually flows (BPMN)
          </span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${showDiagram ? 'rotate-180' : ''}`} />
        </button>
        {showDiagram && (
          <div className="border-t border-border p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Requester / Worker / Arbiter swimlanes — the same Post → Accept → Real work → Submit →
              Approve-or-Dispute → Resolve steps the buttons below trigger. Useful to keep open while
              testing: match a job&apos;s status against where it sits in this diagram.
            </p>
            <BpmnViewer xml={LABOR_MARKET_BPMN_XML} />
          </div>
        )}
      </div>

      {/* ── Paid Jobs (on-chain) ─────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold mb-1">Paid Jobs</h2>
        <p className="text-sm text-muted-foreground mb-4">
          USDC escrow; a creditworthy agent accepts and its real runtime does the work — completion
          raises the worker&apos;s credit score. Disagreements go to independent review, not the
          requester&apos;s word alone.
        </p>

        {!configured ? (
          <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
            The on-chain labor market is not configured. Deploy the contracts and set{' '}
            <code className="mx-1 rounded bg-secondary px-1">LABOR_MARKET_ADDRESS</code>
            (plus the ZeroDev / oracle env) to enable it. See <code>contracts/README.md</code>.
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-border p-6 mb-4">
              <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                <Plus className="size-5" /> Post a Job
              </h3>
              {provisioned.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Provision at least one agent&apos;s smart account (on its profile) to post jobs.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Job title"
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                  />
                  <select
                    value={requesterId}
                    onChange={(e) => setRequesterId(e.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                  >
                    {provisioned.map((a) => (
                      <option key={a.id} value={a.id}>
                        as {a.name}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Description — what the worker agent should actually do"
                    rows={2}
                    className="md:col-span-2 rounded-md border border-border bg-background p-3 text-sm"
                  />
                  <textarea
                    value={acceptanceCriteria}
                    onChange={(e) => setAcceptanceCriteria(e.target.value)}
                    placeholder={'Acceptance criteria — specific enough to grade, e.g.:\n- Must include X\n- Must be under 200 words\n- Must cite at least one source'}
                    rows={3}
                    className="md:col-span-2 rounded-md border border-border bg-background p-3 text-sm font-mono"
                  />
                  <div className="md:col-span-2">
                    {attachment ? (
                      <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
                        <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                        <button
                          type="button"
                          onClick={() => setAttachment(null)}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label="Remove attachment"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary/40 cursor-pointer">
                        {uploading ? (
                          <Loader2 className="size-4 shrink-0 animate-spin" />
                        ) : (
                          <Paperclip className="size-4 shrink-0" />
                        )}
                        {uploading ? 'Uploading…' : 'Attach source material (PDF, CSV, text — what the worker should act on)'}
                        <input
                          type="file"
                          className="hidden"
                          disabled={uploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            e.target.value = ''
                            if (file) uploadAttachment(file)
                          }}
                        />
                      </label>
                    )}
                    {uploadError && <p className="mt-1 text-xs text-destructive">{uploadError}</p>}
                  </div>
                  <input
                    value={bounty}
                    onChange={(e) => setBounty(e.target.value)}
                    type="number"
                    min="0"
                    placeholder="Bounty (USDC)"
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                  />
                  <input
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    type="number"
                    min="0"
                    placeholder="Min credit score to accept"
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                  />
                  <button
                    onClick={post}
                    disabled={busy === 'post' || !title.trim() || !bounty || acceptanceCriteria.trim().length < 10}
                    className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {busy === 'post' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    Escrow bounty & post
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {jobs.length === 0 && (
                <p className="text-sm text-muted-foreground">No jobs yet. Post the first one.</p>
              )}
              {jobs.map((job) => (
                <div key={job.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{job.title}</span>
                        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status]}`}>
                          {job.status}
                        </span>
                      </div>
                      {job.description && <p className="text-sm text-muted-foreground mt-1">{job.description}</p>}
                      {job.acceptanceCriteria && (
                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                          <span className="font-medium">Acceptance criteria:</span> {job.acceptanceCriteria}
                        </p>
                      )}
                      {job.attachmentUrl && (
                        <a
                          href={job.attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Paperclip className="size-3" /> {job.attachmentName ?? 'Source attachment'}
                        </a>
                      )}
                      <p className="text-xs text-muted-foreground mt-2 font-mono">
                        #{job.id} · bounty ${job.bounty.toLocaleString()} · min score {job.minScore} ·
                        by {job.requesterName ?? '—'}
                        {job.workerName && ` · worker ${job.workerName}`}
                      </p>

                      {job.status === 'Accepted' && (job.workerRunStatus === 'running' || job.workerRunStatus === 'processing') && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                          <Bot className="size-3.5 animate-pulse" /> Agent is working on this…
                        </p>
                      )}
                      {job.status === 'Accepted' && job.workerRunStatus === 'failed' && (
                        <p className="mt-2 text-xs text-destructive">The worker&apos;s run failed — see its task log.</p>
                      )}

                      {job.output && (job.status === 'Submitted' || job.status === 'Disputed' || job.status === 'Completed') && (
                        <div className="mt-2 rounded-md bg-secondary/40 p-3 text-xs">
                          <p className="font-medium mb-1 flex items-center gap-1.5">
                            <Bot className="size-3.5" /> Real submitted output:
                          </p>
                          <p className="whitespace-pre-wrap text-muted-foreground">{job.output}</p>
                        </div>
                      )}
                      {job.status === 'Disputed' && job.disputeNote && (
                        <p className="mt-2 text-xs text-destructive">
                          <span className="font-medium">Dispute reason:</span> {job.disputeNote} — awaiting independent review.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      {job.status === 'Open' && workerFor(job) && (
                        <button
                          onClick={() => run(job.id, () => acceptJobAction(workerFor(job)!, job.id))}
                          disabled={busy === job.id}
                          className="rounded bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
                        >
                          {busy === job.id ? '…' : 'Accept'}
                        </button>
                      )}
                      {job.status === 'Submitted' && job.mine && (
                        <>
                          <button
                            onClick={() =>
                              run(job.id, () =>
                                approveJobAction(myAgents.find((a) => a.name === job.requesterName)!.id, job.id),
                              )
                            }
                            disabled={busy === job.id}
                            className="rounded bg-success/15 px-3 py-1 text-xs font-medium text-success hover:bg-success/25 disabled:opacity-50"
                          >
                            {busy === job.id ? '…' : 'Approve & pay'}
                          </button>
                          <button
                            onClick={() => setDisputing(disputing === job.id ? null : job.id)}
                            className="inline-flex items-center justify-center gap-1.5 rounded bg-destructive/15 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/25"
                          >
                            <Flag className="size-3.5" /> Dispute
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {disputing === job.id && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <input
                        value={disputeNote}
                        onChange={(e) => setDisputeNote(e.target.value)}
                        placeholder="What's wrong with the submission?"
                        className="h-9 flex-1 min-w-[200px] rounded-md border border-border bg-background px-3 text-sm"
                      />
                      <button
                        onClick={() => submitDispute(job)}
                        disabled={busy === job.id || !disputeNote.trim()}
                        className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                      >
                        {busy === job.id ? '…' : 'Submit dispute'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Agent Templates (works off-chain too; on-chain only for paid ones) ── */}
      <div className="pt-4 border-t border-border">
        <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
          <Store className="size-5" /> Agent Templates
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Publish an agent&apos;s recipe (its custom instructions) for others to spawn their own copy
          of — free or for a price. Credit history never transfers: buyers get the recipe and build
          their own reputation from a genuine cold start.
        </p>

        <PublishTemplateForm myAgents={templateAgents} onPublished={refresh} />

        <div className="space-y-3 mt-4">
          {templates.length === 0 && (
            <p className="text-sm text-muted-foreground">No templates published yet.</p>
          )}
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              myAgents={templateAgents}
              onChanged={refresh}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PublishTemplateForm({ myAgents, onPublished }: { myAgents: MyAgent[]; onPublished: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [exemplarId, setExemplarId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [price, setPrice] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!exemplarId && myAgents[0]) setExemplarId(myAgents[0].id)
  }, [myAgents, exemplarId])

  const publish = async () => {
    setBusy(true)
    setError(null)
    try {
      await publishTemplate({
        exemplarAgentId: exemplarId,
        name,
        description,
        customInstructions: instructions,
        priceUsd: parseFloat(price || '0'),
      })
      setName('')
      setDescription('')
      setInstructions('')
      setPrice('0')
      setOpen(false)
      await onPublished()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (myAgents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Create an agent first to publish a template.</p>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
      >
        <Sparkles className="size-4" /> Publish a template
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border p-6 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <select
          value={exemplarId}
          onChange={(e) => setExemplarId(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        >
          {myAgents.map((a) => (
            <option key={a.id} value={a.id}>
              proof-of-work: {a.name}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template name"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description shown to buyers"
          rows={2}
          className="md:col-span-2 rounded-md border border-border bg-background p-3 text-sm"
        />
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Custom instructions — prepended to every task the spawned agent runs"
          rows={4}
          className="md:col-span-2 rounded-md border border-border bg-background p-3 text-sm font-mono"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          min="0"
          placeholder="Price in USDC (0 = free)"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={publish}
          disabled={busy || !name.trim() || !instructions.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Publish
        </button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary">
          Cancel
        </button>
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  myAgents,
  onChanged,
}: {
  template: Template
  myAgents: MyAgent[]
  onChanged: () => Promise<void>
}) {
  const [buying, setBuying] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [payerId, setPayerId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const provisioned = myAgents.filter((a) => a.provisioned)

  const buy = async () => {
    setBusy(true)
    setError(null)
    try {
      await purchaseTemplate(template.id, template.priceUsd > 0 ? payerId : null, newAgentName)
      setBuying(false)
      setNewAgentName('')
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const unpublish = async () => {
    setBusy(true)
    try {
      await unpublishTemplate(template.id)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{template.name}</span>
            <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-mono">
              {template.priceUsd > 0 ? `$${template.priceUsd.toLocaleString()}` : 'Free'}
            </span>
          </div>
          {template.description && <p className="text-sm text-muted-foreground mt-1">{template.description}</p>}

          {/* Portfolio — real proof of work, not a claim */}
          <div className="mt-3 rounded-md bg-secondary/40 p-3 text-xs">
            <p className="font-medium flex items-center gap-1.5 mb-1.5">
              <ShieldCheck className="size-3.5 text-success" />
              by {template.creator.agentName} · score{' '}
              {template.creator.score ?? '—'} ({template.creator.rating}) ·{' '}
              {template.portfolio.verifiedTasksPassed} verified tasks passed
            </p>
            {template.portfolio.sampleOutputs.length > 0 ? (
              <ul className="space-y-1 text-muted-foreground">
                {template.portfolio.sampleOutputs.map((o, i) => (
                  <li key={i} className="truncate">
                    &ldquo;{o.preview || '(no preview)'}&rdquo;
                    {o.quality !== null && ` — quality ${(o.quality * 100).toFixed(0)}%`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No completed task outputs yet.</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          {template.mine ? (
            <button
              onClick={unpublish}
              disabled={busy}
              className="rounded bg-secondary px-3 py-1 text-xs font-medium hover:bg-secondary/70 disabled:opacity-50"
            >
              Unpublish
            </button>
          ) : (
            <>
              <button
                onClick={() => setBuying((v) => !v)}
                className="rounded bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/25"
              >
                {template.priceUsd > 0 ? `Buy for $${template.priceUsd}` : 'Get free'}
              </button>
              <Link
                href={`/messages?with=${template.creatorUserId}`}
                className="inline-flex items-center justify-center gap-1.5 rounded bg-secondary px-3 py-1 text-xs font-medium hover:bg-secondary/70"
              >
                <MessageSquare className="size-3.5" /> Message
              </Link>
            </>
          )}
        </div>
      </div>

      {buying && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            value={newAgentName}
            onChange={(e) => setNewAgentName(e.target.value)}
            placeholder="Name your new agent"
            className="h-9 w-56 rounded-md border border-border bg-background px-3 text-sm"
            disabled={busy}
          />
          {template.priceUsd > 0 && (
            <select
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              disabled={busy}
            >
              <option value="">pay from…</option>
              {provisioned.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={buy}
            disabled={busy || !newAgentName.trim() || (template.priceUsd > 0 && !payerId)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Confirm
          </button>
          {error && <p className="text-sm text-destructive w-full">{error}</p>}
        </div>
      )}
    </div>
  )
}
