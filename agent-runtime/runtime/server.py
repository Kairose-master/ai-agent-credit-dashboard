"""FastAPI surface of the agent runtime.

The runtime is a stateless execution service. To avoid holding a request open
for the multi-minute duration of an agent run (which would trip the caller's
serverless function timeout), /run is asynchronous:

    Next.js POST /run  ──▶  202 accepted (returns immediately)
                              │  (background thread)
                              ▼
    run agent workflow ──▶  POST callback_url with events + result

Both directions are authenticated with a shared secret (X-Runtime-Secret).
"""
from __future__ import annotations

import threading

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import config
from .graph import run_task

app = FastAPI(title="AI Agent Runtime", version="0.2.0")


class RunRequest(BaseModel):
    agent_id: str = Field(min_length=1)
    task_id: str = Field(min_length=1)
    task: str = Field(min_length=1, max_length=4000)
    callback_url: str = Field(min_length=1)
    # BYOK: the requesting user's own Anthropic key. Optional — without it the
    # runtime bills its own ANTHROPIC_API_KEY. Never logged.
    api_key: str | None = None


def _require_secret(provided: str | None) -> None:
    """Enforce the shared secret when one is configured."""
    if config.RUNTIME_SHARED_SECRET and provided != config.RUNTIME_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing runtime secret")


def _process(request: RunRequest) -> None:
    """Run the agent, then report the outcome back to the caller."""
    # The wallet API lives at the same origin as the callback endpoint.
    wallet_api = request.callback_url.rsplit("/", 1)[0] + "/wallet"
    result = run_task(
        request.agent_id,
        request.task_id,
        request.task,
        api_key=request.api_key,
        wallet_api=wallet_api,
    )
    payload = {"task_id": request.task_id, "agent_id": request.agent_id, **result}
    headers = {"Content-Type": "application/json"}
    if config.RUNTIME_SHARED_SECRET:
        headers["X-Runtime-Secret"] = config.RUNTIME_SHARED_SECRET
    try:
        httpx.post(request.callback_url, json=payload, headers=headers, timeout=30)
    except Exception as exc:  # the run is done; only delivery failed
        print(f"[runtime] callback to {request.callback_url} failed: {exc}", flush=True)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": config.ANTHROPIC_MODEL}


@app.post("/run", status_code=202)
def run(request: RunRequest, x_runtime_secret: str | None = Header(default=None)) -> dict:
    _require_secret(x_runtime_secret)
    threading.Thread(target=_process, args=(request,), daemon=True).start()
    return {"status": "accepted", "task_id": request.task_id}
