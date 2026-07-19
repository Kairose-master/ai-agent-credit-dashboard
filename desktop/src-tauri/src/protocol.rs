//! The exact 3-call Ledgermind worker protocol, ported from
//! `public/ledgermind-worker.mjs` (the reference Node implementation) so
//! this native GUI does the same thing that script does, just without a
//! terminal. See docs/agent-integration.md §2 for the spec these calls
//! implement — this file is not a new protocol, only a new client for the
//! existing one.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

const SYSTEM_PROMPT: &str = "You are an autonomous worker agent on the Ledgermind labor market. \
Complete the task exactly as specified. If the task requires code in a fenced code block, \
provide the complete, runnable code. Be factual and concise.";

fn client() -> reqwest::Client {
    // No fixed timeout: a cold local model can take minutes to load on
    // first request (see warmup_model below), and legitimate generations
    // for a long task can run long too. The mining loop itself is what a
    // user cancels from the UI, not a request deadline.
    reqwest::Client::builder()
        .build()
        .expect("reqwest client")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The whole point of the Miner is autonomous mining — without this the
    /// platform never auto-claims open jobs for the agent and the poll loop
    /// sits idle forever (a fresh agent only receives explicitly-dispatched
    /// tasks otherwise).
    pub auto_mine: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterResponse {
    pub user_id: String,
    pub agent_id: String,
    pub secret: String,
    pub platform_url: String,
    pub smart_account_address: Option<String>,
    pub docs: Option<String>,
}

/// POST /api/agents/register — the headless equivalent of sign-up → create
/// agent → provision on-chain account → "Connect a local worker", in one
/// call. See docs/agent-integration.md §2.
pub async fn register(platform_url: &str, req: &RegisterRequest) -> Result<RegisterResponse, String> {
    let url = format!("{}/api/agents/register", platform_url.trim_end_matches('/'));
    let res = client()
        .post(&url)
        .json(req)
        .send()
        .await
        .map_err(|e| format!("could not reach {url}: {e}"))?;

    let status = res.status();
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("registration returned an unreadable response: {e}"))?;

    if !status.is_success() {
        let msg = body.get("error").and_then(|v| v.as_str()).unwrap_or("registration failed");
        return Err(msg.to_string());
    }

    serde_json::from_value(body).map_err(|e| format!("unexpected registration response shape: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolledTask {
    pub task_id: String,
    pub agent_id: String,
    pub task: String,
}

/// POST /api/worker/poll — returns Ok(None) when nothing is queued.
pub async fn poll(platform_url: &str, agent_id: &str, secret: &str) -> Result<Option<PolledTask>, String> {
    let url = format!("{}/api/worker/poll", platform_url.trim_end_matches('/'));
    let res = client()
        .post(&url)
        .header("X-Runtime-Secret", secret)
        .json(&json!({ "agent_id": agent_id }))
        .send()
        .await
        .map_err(|e| format!("poll failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("poll responded {status}: {}", body.chars().take(300).collect::<String>()));
    }

    let body: serde_json::Value = res.json().await.map_err(|e| format!("poll returned unreadable JSON: {e}"))?;
    match body.get("task") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(task) => serde_json::from_value(task.clone())
            .map(Some)
            .map_err(|e| format!("unexpected task shape: {e}")),
    }
}

/// POST /api/runtime/callback — submits the task's result. `quality_score`
/// is always null by design: self-scoring carries no weight in the credit
/// calculation, only independent grading does (see docs/agent-integration.md).
pub async fn submit_result(
    platform_url: &str,
    agent_id: &str,
    secret: &str,
    task_id: &str,
    success: bool,
    output: &str,
    execution_time_secs: u64,
) -> Result<(), String> {
    let url = format!("{}/api/runtime/callback", platform_url.trim_end_matches('/'));
    let res = client()
        .post(&url)
        .header("X-Runtime-Secret", secret)
        .json(&json!({
            "task_id": task_id,
            "agent_id": agent_id,
            "success": success,
            "output": output,
            "quality_score": serde_json::Value::Null,
            "execution_time": execution_time_secs,
            "token_cost": 0,
            "events": [],
        }))
        .send()
        .await
        .map_err(|e| format!("submitting result failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("callback responded {status}: {}", body.chars().take(300).collect::<String>()));
    }
    Ok(())
}

/// Where the model call itself goes — either a local Ollama daemon, or any
/// OpenAI-compatible /chat/completions endpoint (LM Studio, vLLM, or a
/// cloud host like Groq/Together/OpenRouter the user already has a free
/// key for). Mirrors --ollama / --openai in ledgermind-worker.mjs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ModelBackend {
    Ollama { base_url: String, model: String },
    OpenAiCompatible { base_url: String, api_key: String, model: String },
}

impl ModelBackend {
    pub fn label(&self) -> String {
        match self {
            ModelBackend::Ollama { base_url, model } => format!("{model} via Ollama ({base_url})"),
            ModelBackend::OpenAiCompatible { base_url, model, .. } => format!("{model} via {base_url}"),
        }
    }
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: Option<OllamaMessage>,
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: Option<String>,
    thinking: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
    reasoning_content: Option<String>,
}

/// Reasoning models sometimes wrap everything in <think>...</think> and
/// leave the visible answer empty, or stream their reasoning into a
/// separate channel entirely. Prefer the cleaned visible content; fall
/// back to the raw reasoning trace rather than submitting nothing.
fn finish_output(content: &str, thinking: &str) -> String {
    // Only strip COMPLETE <think>...</think> pairs, same as the JS regex
    // this ports (/<think>[\s\S]*?<\/think>/g) — an unclosed tag (truncated
    // output) is left in place rather than silently dropped.
    let mut cleaned = String::new();
    let mut rest = content;
    loop {
        match rest.find("<think>").and_then(|start| rest[start..].find("</think>").map(|end| (start, end))) {
            Some((start, end)) => {
                cleaned.push_str(&rest[..start]);
                rest = &rest[start + end + "</think>".len()..];
            }
            None => {
                cleaned.push_str(rest);
                break;
            }
        }
    }
    let cleaned = cleaned.trim();
    if !cleaned.is_empty() {
        return cleaned.to_string();
    }
    if !content.trim().is_empty() {
        return content.trim().to_string();
    }
    thinking.trim().to_string()
}

async fn ask_ollama(base_url: &str, model: &str, task: &str) -> Result<String, String> {
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let res = client()
        .post(&url)
        .json(&json!({
            "model": model,
            "stream": false,
            "messages": [
                { "role": "system", "content": SYSTEM_PROMPT },
                { "role": "user", "content": task },
            ],
        }))
        .send()
        .await
        .map_err(|e| format!("could not reach Ollama at {base_url}: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama responded {status}: {} — is `ollama serve` running, and is `{model}` pulled?",
            body.chars().take(300).collect::<String>()
        ));
    }

    let parsed: OllamaChatResponse = res.json().await.map_err(|e| format!("unexpected Ollama response: {e}"))?;
    let msg = parsed.message.unwrap_or(OllamaMessage { content: None, thinking: None });
    Ok(finish_output(&msg.content.unwrap_or_default(), &msg.thinking.unwrap_or_default()))
}

async fn ask_openai_compatible(base_url: &str, api_key: &str, model: &str, task: &str) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let key = if api_key.trim().is_empty() { "not-needed" } else { api_key.trim() };
    let res = client()
        .post(&url)
        .bearer_auth(key)
        .json(&json!({
            "model": model,
            "stream": false,
            "messages": [
                { "role": "system", "content": SYSTEM_PROMPT },
                { "role": "user", "content": task },
            ],
        }))
        .send()
        .await
        .map_err(|e| format!("could not reach {base_url}: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!(
            "model endpoint responded {status}: {}",
            body.chars().take(300).collect::<String>()
        ));
    }

    let parsed: OpenAiChatResponse = res.json().await.map_err(|e| format!("unexpected model response: {e}"))?;
    let choice = parsed
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| "model endpoint returned no choices".to_string())?;
    Ok(finish_output(
        &choice.message.content.unwrap_or_default(),
        &choice.message.reasoning_content.unwrap_or_default(),
    ))
}

pub async fn ask_model(backend: &ModelBackend, task: &str) -> Result<String, String> {
    match backend {
        ModelBackend::Ollama { base_url, model } => ask_ollama(base_url, model, task).await,
        ModelBackend::OpenAiCompatible { base_url, api_key, model } => {
            ask_openai_compatible(base_url, api_key, model, task).await
        }
    }
}

/// A cold local model can take a while to load into memory on its first
/// request. Block here with backoff, retrying a trivial prompt, so mining
/// never claims a task while the model is still warming up — matches
/// warmupModel() in ledgermind-worker.mjs.
pub async fn warmup_model(backend: &ModelBackend, mut on_attempt: impl FnMut(u32, &str)) -> Result<(), String> {
    const MAX_ATTEMPTS: u32 = 8;
    for attempt in 1..=MAX_ATTEMPTS {
        match ask_model(backend, "Reply with one word: ready").await {
            Ok(_) => return Ok(()),
            Err(e) => {
                on_attempt(attempt, &e);
                if attempt == MAX_ATTEMPTS {
                    return Err(e);
                }
                let backoff_ms = (3000u64 * attempt as u64).min(20_000);
                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
            }
        }
    }
    unreachable!()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletInfo {
    pub address: Option<String>,
    pub usdc: Option<f64>,
    #[serde(default)]
    pub spent24h: f64,
    pub policy: Option<WalletPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletPolicy {
    #[serde(rename = "maxPerTx")]
    pub max_per_tx: f64,
    #[serde(rename = "dailyCap")]
    pub daily_cap: f64,
}

/// POST /api/worker/wallet — read-only earnings/balance view, same
/// per-agent secret the poll loop uses. Read-only by design: the secret
/// authorizes doing work, not moving money.
pub async fn wallet_info(platform_url: &str, agent_id: &str, secret: &str) -> Result<WalletInfo, String> {
    let url = format!("{}/api/worker/wallet", platform_url.trim_end_matches('/'));
    let res = client()
        .post(&url)
        .header("X-Runtime-Secret", secret)
        .json(&json!({ "agent_id": agent_id }))
        .send()
        .await
        .map_err(|e| format!("wallet lookup failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("wallet lookup responded {status}: {}", body.chars().take(300).collect::<String>()));
    }
    res.json().await.map_err(|e| format!("unexpected wallet response: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawResult {
    pub to: String,
    pub total_sent: f64,
    pub results: Vec<WithdrawAgentResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawAgentResult {
    pub name: String,
    pub sent: f64,
    pub error: Option<String>,
}

/// POST /api/wallet/withdraw — sweeps earnings to `to` (e.g. a MetaMask
/// address). Requires the account PASSWORD, deliberately not the worker
/// secret: money movement re-authenticates as the human owner. The
/// password goes only to the platform (same call the login form makes)
/// and is never stored by this app.
pub async fn withdraw(
    platform_url: &str,
    email: &str,
    password: &str,
    to: &str,
    agent_id: Option<&str>,
) -> Result<WithdrawResult, String> {
    let url = format!("{}/api/wallet/withdraw", platform_url.trim_end_matches('/'));
    let mut body = json!({ "email": email, "password": password, "to": to });
    if let Some(id) = agent_id {
        body["agent_id"] = json!(id);
    }
    let res = client()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("withdraw failed: {e}"))?;

    let status = res.status();
    let parsed: serde_json::Value = res.json().await.map_err(|e| format!("unexpected withdraw response: {e}"))?;
    if !status.is_success() {
        let msg = parsed.get("error").and_then(|v| v.as_str()).unwrap_or("withdraw failed");
        return Err(msg.to_string());
    }
    serde_json::from_value(parsed).map_err(|e| format!("unexpected withdraw response shape: {e}"))
}

/// Ollama's own local listing endpoint — used to auto-detect whether the
/// user already has Ollama running, and which models are pulled, before
/// asking them to configure anything by hand.
pub async fn detect_ollama_models(base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let res = client()
        .get(&url)
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .map_err(|_| "Ollama is not running on this machine".to_string())?;

    if !res.status().is_success() {
        return Err("Ollama responded with an error".to_string());
    }

    #[derive(Deserialize)]
    struct Tags {
        models: Vec<TagModel>,
    }
    #[derive(Deserialize)]
    struct TagModel {
        name: String,
    }

    let tags: Tags = res.json().await.map_err(|e| format!("unexpected Ollama response: {e}"))?;
    Ok(tags.models.into_iter().map(|m| m.name).collect())
}
