const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

const views = {
  register: document.getElementById('view-register'),
  backend: document.getElementById('view-backend'),
  mining: document.getElementById('view-mining'),
}

function showView(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name
}

function setText(id, text) {
  document.getElementById(id).textContent = text
}

function showError(id, message) {
  const el = document.getElementById(id)
  el.textContent = message
  el.hidden = !message
}

// ---------- Step 1: account ----------

async function initRegisterView() {
  const platformInput = document.getElementById('reg-platform')
  platformInput.placeholder = await invoke('default_platform_url')

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    showError('register-error', '')
    const submitBtn = document.getElementById('register-submit')
    submitBtn.disabled = true
    submitBtn.textContent = 'Connecting…'
    try {
      const email = document.getElementById('reg-email').value.trim()
      const password = document.getElementById('reg-password').value
      const name = document.getElementById('reg-name').value.trim()
      const platform_url = platformInput.value.trim() || platformInput.placeholder
      await invoke('register_agent', { platformUrl: platform_url, email, password, name })
      await enterBackendView()
    } catch (err) {
      showError('register-error', String(err))
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Create / connect agent'
    }
  })
}

// ---------- Step 2: model backend ----------

async function enterBackendView() {
  showView('backend')
  showError('backend-error', '')
  document.getElementById('backend-detecting').hidden = false
  document.getElementById('backend-ollama').hidden = true
  document.getElementById('backend-cloud').hidden = true

  try {
    const models = await invoke('detect_ollama')
    document.getElementById('backend-detecting').hidden = true
    if (models.length > 0) {
      const select = document.getElementById('ollama-model')
      select.innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join('')
      document.getElementById('backend-ollama').hidden = false
    } else {
      showBackendCloudFallback('Ollama is running but has no models pulled yet — run `ollama pull llama3.2`, or use a cloud key below.')
    }
  } catch {
    document.getElementById('backend-detecting').hidden = true
    showBackendCloudFallback()
  }
}

function showBackendCloudFallback(note) {
  document.getElementById('backend-cloud').hidden = false
  if (note) showError('backend-error', note)
}

function initBackendView() {
  document.getElementById('use-ollama').addEventListener('click', async () => {
    const model = document.getElementById('ollama-model').value
    await invoke('save_backend', { backend: { kind: 'ollama', base_url: 'http://localhost:11434', model } })
    await enterMiningView()
  })

  document.getElementById('retry-ollama').addEventListener('click', (e) => {
    e.preventDefault()
    enterBackendView()
  })

  document.getElementById('cloud-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const base_url = document.getElementById('cloud-base-url').value.trim()
    const api_key = document.getElementById('cloud-api-key').value.trim()
    const model = document.getElementById('cloud-model').value.trim()
    await invoke('save_backend', { backend: { kind: 'open_ai_compatible', base_url, api_key, model } })
    await enterMiningView()
  })
}

// ---------- Step 3: mining dashboard ----------

function backendLabel(backend) {
  if (backend.kind === 'ollama') return `${backend.model} via Ollama`
  return `${backend.model} via ${backend.base_url}`
}

function appendLog(line) {
  const log = document.getElementById('log')
  const stamp = new Date().toLocaleTimeString()
  log.textContent += `[${stamp}] ${line}\n`
  log.scrollTop = log.scrollHeight
}

function onMiningEvent(payload) {
  if (payload.type === 'Log') {
    appendLog(payload.line)
  } else if (payload.type === 'Status') {
    const badge = document.getElementById('status-badge')
    badge.textContent = payload.state
    badge.dataset.state = payload.state
    setText('stat-completed', String(payload.tasks_completed))
    setText('stat-failed', String(payload.tasks_failed))

    const running = payload.state === 'polling' || payload.state === 'running' || payload.state === 'warming'
    document.getElementById('start-btn').hidden = running
    document.getElementById('stop-btn').hidden = !running
  }
}

// Buttons/listeners for the mining view are bound exactly once at boot —
// enterMiningView() (called on every view transition into it) only
// populates data, so re-entering never double-registers a handler.
function initMiningView() {
  document.getElementById('start-btn').addEventListener('click', async () => {
    appendLog('Starting…')
    try {
      await invoke('start_mining')
    } catch (err) {
      appendLog(`Could not start: ${err}`)
    }
  })

  document.getElementById('stop-btn').addEventListener('click', async () => {
    await invoke('stop_mining')
  })

  document.getElementById('forget-btn').addEventListener('click', async () => {
    await invoke('forget_account')
    location.reload()
  })

  listen('mining-event', (event) => onMiningEvent(event.payload))
}

async function enterMiningView() {
  const cfg = await invoke('load_config')
  if (!cfg.agent) return showView('register')
  if (!cfg.backend) return enterBackendView()

  showView('mining')
  setText('agent-name-display', cfg.agent.name)
  setText('backend-label-display', backendLabel(cfg.backend))
}

// ---------- Boot ----------

async function boot() {
  await initRegisterView()
  initBackendView()
  initMiningView()

  const cfg = await invoke('load_config')
  if (!cfg.agent) {
    showView('register')
  } else if (!cfg.backend) {
    await enterBackendView()
  } else {
    await enterMiningView()
  }
}

boot()
