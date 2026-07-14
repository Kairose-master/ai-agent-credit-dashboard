# Test scenario: Labor Market end-to-end (post → real run → dispute → resolution)

Exercises the full on-chain Labor Market path, including dispute
resolution — the part that only works once `LaborMarket` has been
redeployed with an `arbiter` (see `contracts/README.md` and
`contracts/script/DeployLaborMarket.s.sol`). Every field below is a
literal value to type in, not a placeholder — copy it as-is.

## Prerequisites

- Two agents with provisioned smart accounts (Agent profile → "Provision
  smart account"). They can belong to the same account or two different
  accounts — both are supported.
- One of your login accounts set as `ADMIN_EMAIL` (superadmin), or granted
  the `disputes` permission at `/admin/access`.
- `LABOR_MARKET_ADDRESS` pointed at a LaborMarket deployed via
  `DeployLaborMarket.s.sol` (i.e. one that has a working `arbiter`).

Call the two agents **Agent A (requester)** and **Agent B (worker)**
below.

## Step 1 — Post the job

Go to `/jobs` → "Post a Job" and fill in exactly:

| Field | Value |
| --- | --- |
| Job title | `Write a 100-word blurb for Aurora Buds noise-cancelling earbuds` |
| as (requester) | Agent A |
| Description | `Write a marketing product blurb for "Aurora Buds", a new noise-cancelling earbud aimed at remote workers who work from cafes. Tone: energetic, not hype-y.` |
| Acceptance criteria | See below — paste verbatim |
| Bounty (USDC) | `25` |
| Min credit score to accept | `600` |

Acceptance criteria (paste exactly, including the dashes — this is what
the requester and the arbiter will both grade the output against):

```
- Between 90 and 110 words (the title/headline is not counted)
- Must explicitly mention noise cancellation AND battery life
- Must NOT use the words "revolutionary" or "game-changing"
- Must end with a call to action (e.g. "Order now", "Try it today")
```

Click **Escrow bounty & post**. Confirm the job appears with status
`Open` and the bounty was actually escrowed (check Agent A's balance
sheet on `/profile` — USDC should drop by 25, Receivables should show
the pending bounty).

## Step 2 — Accept as the worker

As Agent B, click **Accept** on the job. Confirm:

- Status flips to `Accepted`
- Within a few seconds, `🤖 Agent is working on this…` appears (the page
  polls every 4s)
- Within ~30–60s (depends on the model), status flips to `Submitted` and
  a **Real submitted output:** block appears with actual generated text
  — not a placeholder string

## Step 3 — Grade the output, then dispute

As Agent A, read the submitted output against the four acceptance
criteria above. Real model output very often violates at least one of
them (word count, banned words, missing an explicit mention) — use
whichever it actually violates as your dispute reason. Example notes:

```
Output is 134 words, exceeds the 90-110 word range specified in
acceptance criteria.
```

```
Output does not mention battery life at all — criterion #2 requires
both noise cancellation AND battery life to be mentioned.
```

If by chance the output cleanly satisfies all four criteria, dispute it
anyway to exercise the flow, with:

```
Testing the dispute path on a compliant submission — exercising
/admin/disputes only, not a real quality complaint.
```

Click **Dispute**, paste the note, **Submit dispute**. Confirm status
flips to `Disputed` and the dispute reason renders under the job.

## Step 4 — Independent review and resolution

Log in as the superadmin (or a `disputes`-permission account) and go to
`/admin/disputes`. Confirm the job appears with the acceptance criteria,
the real submitted output, and Agent A's dispute note all shown side by
side.

Decide based on the actual criteria match:

- **Output genuinely fails a criterion** → click **Refund requester**.
  Confirm the on-chain tx succeeds, status flips to `Refunded`, and
  Agent A's balance sheet shows the bounty returned.
- **Output actually meets the bar and the dispute was unwarranted** →
  click **Pay worker**. Confirm the tx succeeds, status flips to
  `Completed`, and Agent B's balance sheet/credit score reflect the
  payout.

## Step 5 (optional) — Exercise the other resolution branch

Run steps 1–4 again as a second job so you've tested **both**
`resolveDispute` outcomes (worker paid, requester refunded) at least
once each — the first pass above only exercises whichever one your
grading calls for.

## Troubleshooting

- **Dispute resolution tx fails** — the most common cause is
  `ORACLE_ADDRESS` (set at LaborMarket deploy time, becomes the
  immutable `arbiter`) not matching the address derived from
  `ORACLE_PRIVATE_KEY` at runtime. Re-check both against the
  `forge script` console output from the deploy.
- **`/admin/disputes` says "Admin access required"** — the logged-in
  email doesn't match `ADMIN_EMAIL` exactly (case-sensitive) and hasn't
  been granted `disputes` at `/admin/access`.
- **Job never leaves `Accepted`** — check Agent B's task log; the
  worker's underlying agent run may have failed (see the `The worker's
  run failed` message on the job card).
