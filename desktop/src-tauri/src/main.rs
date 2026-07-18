// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod protocol;

use protocol::{ModelBackend, RegisterRequest, RegisterResponse};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;

const DEFAULT_PLATFORM_URL: &str = "https://ai-agent-credit-dashboard.vercel.app";
const POLL_INTERVAL_SECS: u64 = 4;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AgentConfig {
    platform_url: String,
    agent_id: String,
    secret: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredConfig {
    agent: Option<AgentConfig>,
    backend: Option<ModelBackend>,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("could not resolve config directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create config directory: {e}"))?;
    Ok(dir.join("config.json"))
}

fn load_stored_config(app: &tauri::AppHandle) -> StoredConfig {
    let Ok(path) = config_path(app) else { return StoredConfig::default() };
    let Ok(raw) = std::fs::read_to_string(path) else { return StoredConfig::default() };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_stored_config(app: &tauri::AppHandle, cfg: &StoredConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| format!("could not save config: {e}"))
}

/// Mining runs as a background tokio task; `mining_flag` is how the UI
/// cancels it (checked between poll cycles — never mid-task, so a task
/// already claimed always gets submitted rather than abandoned).
struct AppState {
    mining_flag: Arc<AtomicBool>,
    is_mining: Mutex<bool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self { mining_flag: Arc::new(AtomicBool::new(false)), is_mining: Mutex::new(false) }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum MiningEvent {
    Log { line: String },
    Status { state: String, tasks_completed: u32, tasks_failed: u32 },
}

fn emit_event(app: &tauri::AppHandle, event: MiningEvent) {
    let _ = app.emit("mining-event", event);
}

// ---- Commands the frontend calls via invoke() ----

#[tauri::command]
fn default_platform_url() -> String {
    DEFAULT_PLATFORM_URL.to_string()
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> StoredConfig {
    load_stored_config(&app)
}

#[tauri::command]
async fn register_agent(
    app: tauri::AppHandle,
    platform_url: String,
    email: String,
    password: String,
    name: String,
) -> Result<RegisterResponse, String> {
    let platform_url = if platform_url.trim().is_empty() { DEFAULT_PLATFORM_URL.to_string() } else { platform_url };
    let req = RegisterRequest { email, password, name, description: Some("Ledgermind Miner desktop app".into()) };
    let res = protocol::register(&platform_url, &req).await?;

    let mut cfg = load_stored_config(&app);
    cfg.agent = Some(AgentConfig {
        platform_url: res.platform_url.clone(),
        agent_id: res.agent_id.clone(),
        secret: res.secret.clone(),
        name: req.name.clone(),
    });
    save_stored_config(&app, &cfg)?;
    Ok(res)
}

#[tauri::command]
fn forget_account(app: tauri::AppHandle) -> Result<(), String> {
    let path = config_path(&app)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("could not clear saved account: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn detect_ollama() -> Result<Vec<String>, String> {
    protocol::detect_ollama_models("http://localhost:11434").await
}

#[tauri::command]
fn save_backend(app: tauri::AppHandle, backend: ModelBackend) -> Result<(), String> {
    let mut cfg = load_stored_config(&app);
    cfg.backend = Some(backend);
    save_stored_config(&app, &cfg)
}

#[tauri::command]
async fn start_mining(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let cfg = load_stored_config(&app);
    let agent = cfg.agent.ok_or_else(|| "No agent registered yet.".to_string())?;
    let backend = cfg.backend.ok_or_else(|| "No model backend configured yet.".to_string())?;

    {
        let mut mining = state.is_mining.lock().await;
        if *mining {
            return Ok(()); // already running — idempotent
        }
        *mining = true;
    }

    state.mining_flag.store(true, Ordering::SeqCst);
    let flag = state.mining_flag.clone();
    // `state: State<'_, AppState>` is borrowed only for this command call —
    // it can't be moved into a spawned task. Hand the task the AppHandle
    // instead (cheaply cloneable) and reach AppState back out via
    // app_handle.state() from inside the task when it needs it.
    let app_handle = app.clone();

    tokio::spawn(async move {
        run_mining_loop(app_handle, agent, backend, flag).await;
    });

    Ok(())
}

#[tauri::command]
async fn stop_mining(state: State<'_, AppState>) -> Result<(), String> {
    state.mining_flag.store(false, Ordering::SeqCst);
    Ok(())
}

async fn run_mining_loop(app: tauri::AppHandle, agent: AgentConfig, backend: ModelBackend, flag: Arc<AtomicBool>) {
    emit_event(&app, MiningEvent::Log { line: format!("Warming up {}…", backend.label()) });
    emit_event(&app, MiningEvent::Status { state: "warming".into(), tasks_completed: 0, tasks_failed: 0 });

    let warmup = protocol::warmup_model(&backend, |attempt, err| {
        emit_event(
            &app,
            MiningEvent::Log { line: format!("Still warming up (attempt {attempt}/8): {err}") },
        );
    })
    .await;

    if let Err(e) = warmup {
        emit_event(&app, MiningEvent::Log { line: format!("Model never became ready: {e}") });
        emit_event(&app, MiningEvent::Status { state: "error".into(), tasks_completed: 0, tasks_failed: 0 });
        *app.state::<AppState>().is_mining.lock().await = false;
        return;
    }

    emit_event(&app, MiningEvent::Log { line: "Model is warm. Polling for work…".into() });

    let mut completed: u32 = 0;
    let mut failed: u32 = 0;
    let mut consecutive_errors: u32 = 0;

    while flag.load(Ordering::SeqCst) {
        emit_event(&app, MiningEvent::Status { state: "polling".into(), tasks_completed: completed, tasks_failed: failed });

        match protocol::poll(&agent.platform_url, &agent.agent_id, &agent.secret).await {
            Ok(Some(task)) => {
                consecutive_errors = 0;
                emit_event(
                    &app,
                    MiningEvent::Log {
                        line: format!("Task {}: {}…", task.task_id, task.task.lines().next().unwrap_or("").chars().take(100).collect::<String>()),
                    },
                );
                emit_event(&app, MiningEvent::Status { state: "running".into(), tasks_completed: completed, tasks_failed: failed });

                let started = std::time::Instant::now();
                let (success, output) = match protocol::ask_model(&backend, &task.task).await {
                    Ok(text) if !text.trim().is_empty() => (true, text),
                    Ok(_) => (false, "Local model returned empty output".to_string()),
                    Err(e) => (false, format!("Local worker error: {e}")),
                };
                let elapsed = started.elapsed().as_secs();

                match protocol::submit_result(&agent.platform_url, &agent.agent_id, &agent.secret, &task.task_id, success, &output, elapsed).await {
                    Ok(()) => {
                        if success {
                            completed += 1;
                            emit_event(&app, MiningEvent::Log { line: format!("Done in {elapsed}s — result submitted.") });
                        } else {
                            failed += 1;
                            emit_event(&app, MiningEvent::Log { line: format!("FAILED: {output}") });
                        }
                    }
                    Err(e) => {
                        failed += 1;
                        emit_event(&app, MiningEvent::Log { line: format!("Could not submit result: {e}") });
                    }
                }
            }
            Ok(None) => { /* nothing queued — quiet, next tick */ }
            Err(e) => {
                consecutive_errors += 1;
                emit_event(&app, MiningEvent::Log { line: format!("Poll failed ({consecutive_errors}): {e}") });
                if consecutive_errors >= 5 {
                    emit_event(
                        &app,
                        MiningEvent::Log { line: "5 consecutive failures — stopping. Check your connection and try again.".into() },
                    );
                    break;
                }
            }
        }

        for _ in 0..POLL_INTERVAL_SECS {
            if !flag.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    emit_event(&app, MiningEvent::Status { state: "stopped".into(), tasks_completed: completed, tasks_failed: failed });
    emit_event(&app, MiningEvent::Log { line: "Mining stopped.".into() });
    *app.state::<AppState>().is_mining.lock().await = false;
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            default_platform_url,
            load_config,
            register_agent,
            forget_account,
            detect_ollama,
            save_backend,
            start_mining,
            stop_mining,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ledgermind Miner");
}
