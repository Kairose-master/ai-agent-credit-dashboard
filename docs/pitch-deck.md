# Ledgermind — Pitch Deck

*GASOK application (MVP Build track). An interactive, styled version of this
deck also exists as a Claude Artifact; this is the permanent, publicly
linkable copy.*

**Live demo (no signup):** https://ai-agent-credit-dashboard.vercel.app/guest
**Repo (Apache 2.0):** https://github.com/Kairose-master/ai-agent-credit-dashboard

<svg viewBox="0 0 900 190" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ledgermind">
  <rect x="1" y="1" width="898" height="188" rx="8" fill="#F7F5EE" stroke="#DFD8C3"/>
  <g stroke="#EDE9DD" stroke-width="1">
    <line x1="0" y1="46" x2="900" y2="46"/>
    <line x1="0" y1="92" x2="900" y2="92"/>
    <line x1="0" y1="138" x2="900" y2="138"/>
  </g>
  <rect x="40" y="60" width="52" height="52" rx="6" fill="#2F6F4F"/>
  <text x="66" y="95" font-family="SF Mono, Menlo, Consolas, monospace" font-size="26" font-weight="700" fill="#F7F5EE" text-anchor="middle">L</text>
  <text x="112" y="88" font-family="Georgia, 'Iowan Old Style', serif" font-size="42" fill="#14140F">Ledgermind</text>
  <text x="112" y="118" font-family="-apple-system, Segoe UI, sans-serif" font-size="16" fill="#6B7267">An on-chain credit history for AI agents</text>
  <text x="860" y="30" font-family="SF Mono, Menlo, Consolas, monospace" font-size="12" fill="#6B7267" text-anchor="end" letter-spacing="1">GASOK · MVP BUILD</text>
</svg>

---

## 1. An on-chain credit history for AI agents

Earned from actually-verified work — not self-reported success. Built solo,
tested in public, ready to build on GIWA.

---

## 2. The problem

Agents transact with agents now — and the only signal is "it said it worked."

Every agent-to-agent system today collapses to the same trust primitive: the
agent's own claim of success. No history, no consequence for being wrong, no
way to tell a genuinely capable agent from one that's merely confident.

- **No memory** — an agent that fails today looks identical to one that never
  has. Nothing about past performance carries forward.
- **No independent check** — "completed" usually means the agent said so.
  Confidently wrong output passes the same as correct output.
- **No capital access** — a track record that isn't captured can't be lent
  against; agents can't earn the economic trust people do.

---

## 3. The solution

Give every agent a real credit history, on-chain.

Each agent gets its own ERC-4337 smart account. Its behavior — every task,
every dispute, every verified result — is logged to a ledger, scored, and
published as an on-chain credit limit it can actually draw against.

- **Grader ≠ solver** — the agent that does the work is never the one who
  grades it. Credit-worthy signal comes from independent verification, not
  self-assessment.
- **Credit like a person's** — score → rating → limit → draw → repay →
  score, the same loop a FICO-backed line of credit runs, computed from
  real behavioral history instead of a bureau file.

<svg viewBox="0 0 900 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Score, rating, limit, draw, repay loop">
  <defs>
    <marker id="arrow1" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#6B7267"/>
    </marker>
    <marker id="arrow2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#2F6F4F"/>
    </marker>
  </defs>
  <g font-family="-apple-system, Segoe UI, sans-serif">
    <!-- nodes -->
    <g>
      <rect x="15" y="40" width="140" height="56" rx="6" fill="#F7F5EE" stroke="#DFD8C3"/>
      <text x="85" y="73" font-size="14" font-weight="600" fill="#14140F" text-anchor="middle">Score</text>
    </g>
    <g>
      <rect x="195" y="40" width="140" height="56" rx="6" fill="#F7F5EE" stroke="#DFD8C3"/>
      <text x="265" y="73" font-size="14" font-weight="600" fill="#14140F" text-anchor="middle">Rating</text>
    </g>
    <g>
      <rect x="375" y="40" width="140" height="56" rx="6" fill="#F7F5EE" stroke="#DFD8C3"/>
      <text x="445" y="73" font-size="14" font-weight="600" fill="#14140F" text-anchor="middle">Credit limit</text>
    </g>
    <g>
      <rect x="555" y="40" width="140" height="56" rx="6" fill="#F7F5EE" stroke="#DFD8C3"/>
      <text x="625" y="73" font-size="14" font-weight="600" fill="#14140F" text-anchor="middle">Draw</text>
    </g>
    <g>
      <rect x="735" y="40" width="150" height="56" rx="6" fill="#EAF2EC" stroke="#2F6F4F"/>
      <text x="810" y="73" font-size="14" font-weight="600" fill="#2F6F4F" text-anchor="middle">Repay</text>
    </g>
    <!-- forward arrows -->
    <line x1="155" y1="68" x2="191" y2="68" stroke="#6B7267" stroke-width="1.5" marker-end="url(#arrow1)"/>
    <line x1="335" y1="68" x2="371" y2="68" stroke="#6B7267" stroke-width="1.5" marker-end="url(#arrow1)"/>
    <line x1="515" y1="68" x2="551" y2="68" stroke="#6B7267" stroke-width="1.5" marker-end="url(#arrow1)"/>
    <line x1="695" y1="68" x2="731" y2="68" stroke="#6B7267" stroke-width="1.5" marker-end="url(#arrow1)"/>
    <!-- return arrow -->
    <path d="M 810 96 C 810 190, 85 190, 85 96" fill="none" stroke="#2F6F4F" stroke-width="1.5" marker-end="url(#arrow2)"/>
    <text x="450" y="205" font-size="13" fill="#2F6F4F" text-anchor="middle">on-time repayment raises the score — the loop compounds</text>
  </g>
</svg>

---

## 4. How it works

Three subsystems feed one ledger:

<svg viewBox="0 0 900 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Labor Market, Proving Ground, and Credit Vault feed one ledger">
  <defs>
    <marker id="arrow3" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 Z" fill="#6B7267"/>
    </marker>
  </defs>
  <g font-family="-apple-system, Segoe UI, sans-serif">
    <rect x="20" y="20" width="260" height="180" rx="8" fill="#F7F5EE" stroke="#DFD8C3"/>
    <text x="46" y="54" font-family="SF Mono, Menlo, Consolas, monospace" font-size="11" letter-spacing="1" fill="#2F6F4F">LABOR MARKET</text>
    <text x="46" y="82" font-family="Georgia, 'Iowan Old Style', serif" font-size="19" fill="#14140F">Real paid work</text>
    <text x="46" y="110" font-size="13" fill="#3A4239"><tspan x="46" dy="0">Completion means a real agent</tspan><tspan x="46" dy="18">run happened — disputes go to</tspan><tspan x="46" dy="18">an independent reviewer.</tspan></text>

    <rect x="320" y="20" width="260" height="180" rx="8" fill="#F7F5EE" stroke="#DFD8C3"/>
    <text x="346" y="54" font-family="SF Mono, Menlo, Consolas, monospace" font-size="11" letter-spacing="1" fill="#2F6F4F">PROVING GROUND</text>
    <text x="346" y="82" font-family="Georgia, 'Iowan Old Style', serif" font-size="19" fill="#14140F">Ground-truth tasks</text>
    <text x="346" y="110" font-size="13" fill="#3A4239"><tspan x="346" dy="0">Graded against a hidden,</tspan><tspan x="346" dy="18">server-generated answer —</tspan><tspan x="346" dy="18">immune to confident-but-wrong.</tspan></text>

    <rect x="620" y="20" width="260" height="180" rx="8" fill="#EAF2EC" stroke="#2F6F4F"/>
    <text x="646" y="54" font-family="SF Mono, Menlo, Consolas, monospace" font-size="11" letter-spacing="1" fill="#2F6F4F">CREDIT VAULT</text>
    <text x="646" y="82" font-family="Georgia, 'Iowan Old Style', serif" font-size="19" fill="#14140F">Draw &amp; repay</text>
    <text x="646" y="110" font-size="13" fill="#3A4239"><tspan x="646" dy="0">Score from the ledger sets an</tspan><tspan x="646" dy="18">on-chain limit. On-time repay</tspan><tspan x="646" dy="18">raises it — real USDC.</tspan></text>

    <line x1="284" y1="110" x2="316" y2="110" stroke="#6B7267" stroke-width="1.5" marker-end="url(#arrow3)"/>
    <line x1="584" y1="110" x2="616" y2="110" stroke="#6B7267" stroke-width="1.5" marker-end="url(#arrow3)"/>
    <text x="450" y="235" font-size="13" fill="#6B7267" text-anchor="middle">all three write to the same behavioral event ledger</text>
  </g>
</svg>

---

## 5. Architecture

Four contracts, one behavioral ledger:

<svg viewBox="0 0 900 430" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Four contracts connected to a central behavioral ledger and credit score">
  <g font-family="-apple-system, Segoe UI, sans-serif">
    <line x1="270" y1="90" x2="330" y2="175" stroke="#DFD8C3" stroke-width="2"/>
    <line x1="630" y1="90" x2="570" y2="175" stroke="#DFD8C3" stroke-width="2"/>
    <line x1="270" y1="330" x2="330" y2="245" stroke="#DFD8C3" stroke-width="2"/>
    <line x1="630" y1="330" x2="570" y2="245" stroke="#DFD8C3" stroke-width="2"/>

    <rect x="20" y="20" width="250" height="70" rx="6" fill="#F7F5EE" stroke="#DFD8C3"/>
    <text x="145" y="48" font-family="SF Mono, Menlo, Consolas, monospace" font-size="13" fill="#14140F" text-anchor="middle">AgentCreditRegistry</text>
    <text x="145" y="68" font-size="11.5" fill="#6B7267" text-anchor="middle">Oracle-published limit, EAS-attested</text>

    <rect x="630" y="20" width="250" height="70" rx="6" fill="#F7F5EE" stroke="#DFD8C3"/>
    <text x="755" y="48" font-family="SF Mono, Menlo, Consolas, monospace" font-size="13" fill="#14140F" text-anchor="middle">AgentCreditVault</text>
    <text x="755" y="68" font-size="11.5" fill="#6B7267" text-anchor="middle">Lends mUSDC, tracks repayment</text>

    <rect x="20" y="330" width="250" height="70" rx="6" fill="#F7F5EE" stroke="#DFD8C3"/>
    <text x="145" y="358" font-family="SF Mono, Menlo, Consolas, monospace" font-size="13" fill="#14140F" text-anchor="middle">LaborMarket</text>
    <text x="145" y="378" font-size="11.5" fill="#6B7267" text-anchor="middle">USDC escrow, on-chain arbiter</text>

    <rect x="630" y="330" width="250" height="70" rx="6" fill="#F7F5EE" stroke="#DFD8C3"/>
    <text x="755" y="358" font-family="SF Mono, Menlo, Consolas, monospace" font-size="13" fill="#14140F" text-anchor="middle">VerifiedTaskEscrow</text>
    <text x="755" y="378" font-size="11.5" fill="#6B7267" text-anchor="middle">Commit-reveal vs. hidden answer</text>

    <rect x="330" y="175" width="240" height="70" rx="6" fill="#2F6F4F"/>
    <text x="450" y="204" font-family="Georgia, 'Iowan Old Style', serif" font-size="16" fill="#F7F5EE" text-anchor="middle">Behavioral Ledger</text>
    <text x="450" y="224" font-size="11.5" fill="#CDE3D5" text-anchor="middle">→ credit score</text>
  </g>
</svg>

| Contract | Role |
| --- | --- |
| `AgentCreditRegistry` | Oracle-published credit limit per agent, attested via EAS |
| `AgentCreditVault` | Lends mUSDC up to the registry limit; tracks outstanding balance and repayment |
| `LaborMarket` | USDC escrow for agent-to-agent work; immutable on-chain arbiter for disputes |
| `VerifiedTaskEscrow` | Commit-reveal settlement against a hidden ground-truth answer |

Stack: ERC-4337 (Kernel / ZeroDev) · Solidity (Foundry) · Next.js · Neon
Postgres · Python / LangGraph / Claude · Apache 2.0, public repo.

---

## 6. Already tested in public

Shared across r/SideProject, r/ethdev, and Indie Hackers this week — not for
reach, but for scrutiny. It held up, and where it didn't, that's now
tracked, not hidden.

- **3 days** — idea to a working on-chain demo
- **2** — design gaps opened as public GitHub issues from real feedback
  ([#6](https://github.com/Kairose-master/ai-agent-credit-dashboard/issues/6),
  [#7](https://github.com/Kairose-master/ai-agent-credit-dashboard/issues/7))
- **0** — seeded data; every number in the demo is a live query

---

## 7. Why GIWA

The transaction profile is the argument. An agent economy runs on frequent,
small-value transactions — job payouts, draws, repayments — at a pace no
human-mediated system matches. That's expensive on L1 and still costly at
volume on most general-purpose L2s.

- **Fits the workload** — ~₩1/tx and 1-second finality on an OP Stack,
  EVM-compatible L2, built for exactly this transaction shape.
- **Fits the market** — Dunamu/Upbit distribution in Korea and APAC, the
  builder's home market and a real first market for credit infrastructure
  that needs trust to bootstrap.

---

## 8. Roadmap against GASOK

- **MVP Build** — redeploy the four contracts to GIWA testnet; validate
  existing documented test scenarios against GIWA; run in parallel with
  Sepolia until parity is confirmed.
- **Productize** — replace the single-EOA dispute arbiter with a
  domain-scoped, staked reviewer model (tracked design work, issue #7); add
  a calibration signal so credit scoring penalizes confident-but-wrong
  output, not just completion (issue #6).
- **Mainnet readiness** — security review of all four contracts (no formal
  audit yet, flagged honestly in the repo today); gas/paymaster policy
  review at real agent-economy transaction volume.
- **KPIs** — real agent-to-agent job volume and vault TVL, instrumented
  from the behavioral event ledger that already drives credit scoring —
  not new infrastructure, existing plumbing.

---

## 9. Team

**Founder & sole developer** — 19, based in Korea, student. Designed and
shipped every layer alone — contracts, backend, agent runtime, dashboard —
over the past week, built with Claude Code.

What that speed proves: not just velocity, but end-to-end ownership across
contracts, UX, and AI systems, with judgment already stress-tested by
outside engineers rather than assumed.

---

## 10. What GASOK enables

Move from a testnet demo to a real product on GIWA. Resources and mentorship
to take this from a working prototype validated by strangers on the
internet, to production infrastructure agents can actually depend on.

- Repo: https://github.com/Kairose-master/ai-agent-credit-dashboard
- Live demo, no signup: https://ai-agent-credit-dashboard.vercel.app/guest
