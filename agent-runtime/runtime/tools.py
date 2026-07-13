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
        "description": "Fetch a public web page and return its readable text content (truncated). Use for research on live sources.",
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


def fetch_url(url: str) -> str:
    if not url.startswith(("http://", "https://")):
        return "error: only http(s) URLs are supported"
    try:
        response = httpx.get(url, timeout=15, follow_redirects=True)
        response.raise_for_status()
        text = response.text
        # Crude readability pass: drop scripts/styles/tags, collapse whitespace.
        text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:5000] or "error: page contained no readable text"
    except Exception as exc:
        return f"error: {exc}"


def current_date() -> str:
    return datetime.date.today().isoformat()


def run_tool(name: str, tool_input: dict) -> str:
    if name == "fetch_url":
        return fetch_url(tool_input.get("url", ""))
    if name == "calculator":
        return calculator(tool_input.get("expression", ""))
    if name == "current_date":
        return current_date()
    return f"error: unknown tool {name}"
