"""Tools available to the Research Agent.

Each tool is a plain function plus an Anthropic tool schema. The executor
node lets Claude decide which tools to call; results are fed back into
the conversation until the task is answered.
"""
from __future__ import annotations

import ast
import datetime
import operator
import re

import httpx

TOOL_SCHEMAS = [
    {
        "name": "fetch_url",
        "description": (
            "Fetch a URL and return its readable text content (truncated). Works for web "
            "pages (HTML), plain text/CSV/JSON/Markdown files, and PDFs — including a Labor "
            "Market job's source attachment, if one was given to you. Other binary formats "
            "(images, docx, xlsx, ...) are not supported and return an explicit error."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Absolute http(s) URL to fetch"}
            },
            "required": ["url"],
        },
    },
    {
        "name": "calculator",
        "description": "Evaluate an arithmetic expression (+, -, *, /, **, parentheses). Use for any numeric computation.",
        "input_schema": {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "e.g. (1500 * 0.42) / 12"}
            },
            "required": ["expression"],
        },
    },
    {
        "name": "current_date",
        "description": "Return today's date in ISO format.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "wallet_balance",
        "description": "Check this agent's own on-chain USDC wallet balance and spending limits.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "send_usdc",
        "description": (
            "Send USDC from this agent's own on-chain wallet to an external address. "
            "Use ONLY when the task explicitly requires making a payment. "
            "Subject to per-transfer and daily spending caps enforced by the platform."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient address (0x…, 40 hex chars)"},
                "amount": {"type": "number", "description": "Amount in USDC"},
                "memo": {"type": "string", "description": "Short reason for the payment"},
            },
            "required": ["to", "amount"],
        },
    },
]

_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def _safe_eval(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_safe_eval(node.operand))
    raise ValueError(f"Unsupported expression element: {ast.dump(node)}")


def calculator(expression: str) -> str:
    try:
        result = _safe_eval(ast.parse(expression, mode="eval"))
        return str(result)
    except Exception as exc:  # surfaced to the model as a tool error
        return f"error: {exc}"


_MAX_FETCH_CHARS = 15000


def _truncate(text: str) -> str:
    if len(text) > _MAX_FETCH_CHARS:
        omitted = len(text) - _MAX_FETCH_CHARS
        return text[:_MAX_FETCH_CHARS] + f"\n\n[truncated — {omitted} more characters omitted]"
    return text


def _extract_pdf_text(data: bytes) -> str:
    try:
        import io

        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n\n".join(p for p in pages if p).strip()
        return _truncate(text) if text else "error: PDF contained no extractable text (it may be scanned/image-only)"
    except Exception as exc:
        return f"error: failed to parse PDF: {exc}"


def fetch_url(url: str) -> str:
    if not url.startswith(("http://", "https://")):
        return "error: only http(s) URLs are supported"
    try:
        response = httpx.get(url, timeout=20, follow_redirects=True)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()

        if content_type == "application/pdf" or url.lower().endswith(".pdf"):
            return _extract_pdf_text(response.content)

        if content_type in ("", "text/html", "application/xhtml+xml"):
            # Crude readability pass: drop scripts/styles/tags, collapse whitespace.
            text = response.text
            text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
            text = re.sub(r"(?s)<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()
            return _truncate(text) if text else "error: page contained no readable text"

        if content_type.startswith("text/") or content_type == "application/json":
            text = response.text.strip()
            return _truncate(text) if text else "error: file was empty"

        return (
            f"error: this URL is {content_type or 'an unrecognized binary type'}, which this tool "
            "cannot read. Only HTML, plain text, CSV, JSON, Markdown, and PDF are supported — say so "
            "in your output rather than guessing at the content."
        )
    except Exception as exc:
        return f"error: {exc}"


def current_date() -> str:
    return datetime.date.today().isoformat()


def _wallet_call(ctx: dict | None, action: str, extra: dict | None = None) -> str:
    """Proxy wallet actions to the app's secret-authed wallet API. The runtime
    never holds keys; the app enforces the spending policy and signs."""
    if not ctx or not ctx.get("wallet_api"):
        return "error: wallet not available in this environment"
    try:
        headers = {"Content-Type": "application/json"}
        if ctx.get("secret"):
            headers["X-Runtime-Secret"] = ctx["secret"]
        response = httpx.post(
            ctx["wallet_api"],
            json={"action": action, "agent_id": ctx["agent_id"], **(extra or {})},
            headers=headers,
            timeout=90,
        )
        body = response.text[:500]
        return body if response.status_code == 200 else f"error: {body}"
    except Exception as exc:
        return f"error: {exc}"


def run_tool(name: str, tool_input: dict, ctx: dict | None = None) -> str:
    if name == "fetch_url":
        return fetch_url(tool_input.get("url", ""))
    if name == "calculator":
        return calculator(tool_input.get("expression", ""))
    if name == "current_date":
        return current_date()
    if name == "wallet_balance":
        return _wallet_call(ctx, "balance")
    if name == "send_usdc":
        return _wallet_call(ctx, "transfer", {
            "to": tool_input.get("to", ""),
            "amount": tool_input.get("amount", 0),
            "memo": tool_input.get("memo", ""),
        })
    return f"error: unknown tool {name}"
