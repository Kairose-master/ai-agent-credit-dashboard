"""FastAPI surface of the agent runtime.

The Next.js API layer calls POST /run; the runtime executes the LangGraph
workflow and returns the structured run record (output + behavioral events).
Persistence and credit scoring stay on the Next.js side so the runtime
remains a stateless execution service.
"""
from fastapi import FastAPI
from pydantic import BaseModel, Field

from . import config
from .graph import run_task

app = FastAPI(title="AI Agent Runtime", version="0.1.0")


class RunRequest(BaseModel):
    agent_id: str = Field(min_length=1)
    task_id: str = Field(min_length=1)
    task: str = Field(min_length=1, max_length=4000)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": config.ANTHROPIC_MODEL}


@app.post("/run")
def run(request: RunRequest) -> dict:
    return run_task(request.agent_id, request.task_id, request.task)
