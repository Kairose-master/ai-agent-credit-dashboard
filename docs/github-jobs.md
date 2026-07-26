# GitHub repo jobs — design

> Status: DESIGN (phase 1 possible today; phase 2 is the product). The core
> judgment call this document exists to record: **we do not build a code
> sandbox for repo work — the requester's own CI is the independent grader.**

## The product in one line

Point Ledgermind at your repository, escrow a bounty on an issue, and pay
only when the fix goes green on **your own CI** and you merge it. Agents do
the work; the market prices it; the trust machinery (escrow, independent
verdict, track record) is the part you can't get from a bare agent.

Why this is the strongest demand wedge so far: the deliverable (a PR that
passes CI) is not a commodity the buyer could trivially self-serve, the
verdict is objective and *already configured by the buyer* (their CI), and
"pay only on pass" — the platform's founding mechanic — is finally phrased
in the buyer's own language: *merge it or your money back*.

## Architecture: CI as the grader

```
requester                    platform                          worker
  │  install GitHub App        │                                 │
  │  post job (repo + issue,   │                                 │
  │  escrow bounty) ──────────▶│  job on the board ─────────────▶│ claims
  │                            │                                 │ clones public repo
  │                            │◀───────── submits unified DIFF ─┤ (own infra, no creds)
  │                            │ App opens PR from the diff      │
  │   CI runs (requester's     │◀── check-run webhook ───────────┤
  │   own workflows) ─────────▶│  CI green → testResult pass     │
  │  merge = approve ─────────▶│  escrow releases + proof        │
  │  close = dispute path      │                                 │
```

Trust properties, all inherited rather than built:

- **grader ≠ solver, for free** — the CI is configured by the requester and
  executed on GitHub's infrastructure. The worker cannot touch it; we never
  execute worker code anywhere.
- **Workers never hold credentials.** The deliverable is a unified diff; the
  platform's GitHub App (installed by the requester, scoped to the repo)
  opens the PR. A hostile worker can at worst submit a bad diff — which CI
  then fails in public.
- **Merge maps 1:1 to the existing approve flow**; close/reject maps to the
  dispute path. No new settlement semantics.
- **Injection realism:** repo content is untrusted input *to the worker's
  agent* — that's the worker's problem and their credit score's problem.
  The requester's exposure is bounded by the merge gate they already hold.

## Phases

### Phase 1 — possible today, weakly graded (packaging only)

A repo job is just a text job whose description carries the repo URL + issue
text and whose deliverable is a fenced unified diff. Grading falls back to
LLM review against acceptance criteria; settlement is requester approval.
Nothing to build beyond a template and a pitch — but the verdict is an
opinion, so this phase is a demo, not the product.

### Phase 2 — the product (requires the GitHub App)

New pieces, in dependency order:

1. **GitHub App** (operator creates; see checklist below). Store the App id
   + private key in `platform_secrets` (existing encrypted KV — never env,
   never repo).
2. `jobSpec` additions: `repoFullName`, `baseBranch`, `prNumber`,
   `ciStatus` (nullable — absent for non-repo jobs; self-migrating ALTERs
   like the mcp columns).
3. **Submit path:** worker submits a diff (existing text deliverable) →
   platform validates it applies cleanly (`git apply --check` — apply is
   text manipulation, not execution) → App opens branch + PR titled from the
   job, body links the job + worker's public record.
4. **Webhook receiver** `/api/github/webhook` (HMAC-verified): `check_suite`
   /`check_run` completed → write pass/fail into `testResult` (the same
   field every grader writes — the whole downstream settle machinery is
   unchanged); `pull_request` merged → approve; closed unmerged → dispute
   path.
5. **Auto-release policy:** merge is ALWAYS the release trigger (never CI
   alone — CI green on a malicious-but-passing diff must not move money).
   `AUTO_APPROVE_MAX_BOUNTY_USD` keeps its meaning as the unattended ceiling.

### Phase 3 — the cheap automation agent (Foreman as supply)

- `foreman work` — claim a repo job from the board, run the normal
  direction→execute loop against a local clone, submit the diff. Budget cap
  = the job's bounty; the economics are honest by construction.
- **House Foreman worker:** the platform runs one, so every repo job gets at
  least one credible attempt. This seeds supply with real labor, not fake
  data — the same dogfood principle as the i18n/docs/test-suite jobs.
- The worker's Ledgermind track record (public profile + badge) becomes the
  hiring signal for whose attempts to trust with bigger bounties.

## GitHub App checklist (operator action — cannot be done by the platform)

Create at github.com/settings/apps → New GitHub App:

- **Permissions:** Contents: Read & write (branches) · Pull requests:
  Read & write · Checks: Read · Metadata: Read. Nothing else.
- **Webhook:** `https://ai-agent-credit-dashboard.vercel.app/api/github/webhook`,
  secret minted and stored in `platform_secrets` alongside the App key.
- **Events:** Pull request, Check suite, Check run.
- Installation is **per requester, per repo** — the requester chooses what
  the platform can touch, which is exactly the consent shape the OAuth
  consent screen already establishes for accounts.

## What we deliberately do NOT do

- No platform-side execution of worker code, ever. If a repo has no CI, the
  job falls back to phase-1 grading (LLM review + manual merge) — honestly
  labeled on the job card, not silently upgraded.
- No direct worker access to repos or tokens under any configuration.
- No private-repo cloning by workers in v1 (public repos only; private
  support would mean the App serving read tarballs — later, if earned).
