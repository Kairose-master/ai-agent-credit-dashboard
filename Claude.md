맞아. 이전 출력에서 일부 코드블록 표시가 섞였어. CLAUDE.md 파일에 그대로 복붙할 수 있게 전체를 하나의 마크다운 코드블록으로 다시 정리할게.

# CLAUDE.md
# Project Overview
This project is an AI Agent Credit Infrastructure prototype.
The goal is to demonstrate a new financial primitive:
"Payment allows AI agents to transact. Credit allows AI agents to scale."
The system enables autonomous AI agents to:
1. Perform economic tasks
2. Generate behavioral history
3. Build reputation
4. Receive credit scores
5. Obtain programmable credit limits
Current project state:
- Next.js frontend
- AI Agent Credit Dashboard UI
- Neon PostgreSQL database connected
The objective of this development phase is to transform the static dashboard into a functional end-to-end prototype.
---
# Core Objective
Build a complete vertical slice:

AI Agent executes tasks
↓
Agent behavior generates events
↓
Events are stored in Neon PostgreSQL
↓
Credit scoring engine evaluates reliability
↓
Credit score and credit limit update
↓
Dashboard reflects the economic state of the agent

The prototype must use a real AI agent runtime, not static mock simulations.
---
# Technology Stack
## Frontend
Use:
- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
Responsibilities:
- Agent dashboard
- Credit visualization
- Transaction interface
- Agent activity timeline
Keep business logic outside React components.
---
# AI Agent Runtime
Use:
- Python
- LangGraph
- Anthropic Claude API
The primary reasoning model is Claude.
Use Anthropic models for:
- planning
- reasoning
- tool selection
- task execution
- evaluation
Recommended model:
- Claude Sonnet class model for agent execution
---
# Agent Architecture
Create a modular autonomous agent system.
Initial agent:
Research Agent
Capabilities:
1. Receive a task
2. Create execution plan
3. Select tools
4. Execute actions
5. Evaluate output
6. Generate structured activity logs
Architecture:

Task Input

↓

LangGraph Agent

↓

Planner Node

↓

Tool Execution Node

↓

Evaluation Node

↓

Event Logger

↓

Credit Engine

---
# Agent Event System
Every agent action must generate structured events.
Example:
```json
{
  "agent_id": "research-agent-001",
  "task_id": "task-001",
  "event_type": "TASK_COMPLETED",
  "success": true,
  "execution_time": 42,
  "token_cost": 1500,
  "quality_score": 0.95,
  "timestamp": "2026-07-13"
}

These events are the foundation of the credit layer.

⸻

Database

Use Neon PostgreSQL.

Create the following tables.

agents

Fields:

* id
* name
* wallet_address
* model_version
* credit_score
* credit_rating
* credit_limit
* risk_level
* created_at

agent_events

Fields:

* id
* agent_id
* task_id
* event_type
* success
* execution_time
* token_cost
* quality_score
* created_at

credit_scores

Fields:

* id
* agent_id
* score
* rating
* credit_limit
* calculation_reason
* created_at

credit_transactions

Fields:

* id
* borrower_agent
* lender_agent
* amount
* status
* created_at
* repayment_date

⸻

Credit Scoring Engine

Create a separate credit scoring module.

Do not place scoring logic inside API routes.

The scoring engine converts behavioral history into economic trust.

Formula:

Performance (40%)

Metrics:

* task success rate
* output quality
* completed tasks

Reliability (30%)

Metrics:

* consistency
* failure frequency
* SLA compliance

Reputation (20%)

Metrics:

* verified achievements
* accumulated successful interactions

Risk (10%)

Metrics:

* failures
* abnormal behavior
* uncertainty

Output example:

{
  "credit_score": 875,
  "rating": "AA",
  "credit_limit": 25000,
  "risk_level": "LOW"
}

⸻

API Design

Implement:

POST /api/agents/:id/tasks

Flow:

1. Receive user task
2. Send task to Claude-powered Agent Runtime
3. Execute agent workflow
4. Save execution events
5. Recalculate credit score
6. Return updated credit state

GET /api/agents/:id

Return:

* Agent identity
* Performance metrics
* Credit score
* Credit rating
* Credit limit
* Risk level

GET /api/agents/:id/events

Return:

* Execution history
* Successful tasks
* Failures
* Reputation events

GET /api/agents/:id/credit-history

Return:

* Score changes
* Credit limit changes
* Calculation reasons

⸻

Dashboard Requirements

Replace static mock data.

Connect UI to real database and APIs.

Display:

Agent Credit Profile

* Credit Score
* Credit Rating
* Credit Limit
* Risk Level

Agent Activity Timeline

Examples:

* Completed research task
* Successfully processed API request
* Maintained SLA
* Failed task recovery

Credit Evolution

Example:

Before:

820

After:

865

Reason:

* +500 successful tasks
* +3% reliability improvement

⸻

Future Architecture Compatibility

The system should support future integration.

ERC-4337

Purpose:

* Agent smart accounts
* Programmable spending rules
* Credit-based transaction permissions

Ethereum Attestation Service (EAS)

Purpose:

* On-chain reputation
* Verified behavioral history

Insurance Layer

Purpose:

* Agent risk coverage
* Premium calculation
* Loss protection

Do not implement these yet.

Only ensure the architecture can support them later.

⸻

Development Principles

* Build real agent behavior, not fake data.
* Keep Agent Runtime, Credit Engine, and Frontend separated.
* Prioritize working end-to-end flow.
* Avoid unnecessary dependencies.
* Use clean interfaces between modules.
* Write production-quality code.
* Document financial logic.

⸻

Definition of Done

The prototype is complete when:

1. A Claude-powered AI Agent executes a real task.
2. The execution creates structured behavioral events.
3. Events are persisted in Neon PostgreSQL.
4. Credit scoring recalculates automatically.
5. Agent credit score and limit change.
6. Dashboard displays the updated financial identity.

The final result should demonstrate:

Identity → Behavior → Reputation → Credit Score → Credit Capacity

This is the foundation of an AI Agent Credit Layer.