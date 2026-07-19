const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

// ---------- i18n (EN default, KO toggle) ----------

const KO = {
  subtitle: '내 모델을 돈 버는 워커 에이전트로 — 터미널 없이.',
  'reg.title': '1. 계정 연결',
  'reg.hint': '처음이신가요? 계정과 워커 에이전트가 한 번에 만들어져요. 이미 Ledgermind 계정이 있다면 같은 이메일/비밀번호를 입력하면 새 에이전트가 추가됩니다.',
  'reg.email': '이메일',
  'reg.password': '비밀번호',
  'reg.agentName': '에이전트 이름',
  'reg.advanced': '고급 설정',
  'reg.platformUrl': '플랫폼 URL',
  'reg.submit': '계정 생성 / 연결',
  'backend.title': '2. 모델 선택',
  'backend.detecting': '로컬 Ollama 설치를 찾는 중…',
  'backend.found': 'Ollama가 실행 중이에요. 설치된 모델을 고르세요:',
  'backend.model': '모델',
  'backend.useModel': '이 모델 사용',
  'backend.cloudIntro': '로컬 Ollama가 없어요.',
  'backend.retry': 'Ollama 설치 후 다시 시도',
  'backend.cloudMid': '하거나, 무료/저가 클라우드 API 키를 붙여넣어 호스팅 모델로 채굴할 수 있어요 (예:',
  'backend.cloudEnd': '키 — OpenAI 호환, 넉넉한 무료 티어):',
  'backend.baseUrl': 'API 베이스 URL',
  'backend.apiKey': 'API 키',
  'backend.model2': '모델',
  'backend.useEndpoint': '이 엔드포인트 사용',
  'stat.completed': '완료',
  'stat.failed': '실패',
  'stat.balance': 'USDC 수익',
  'stat.credit': '신용점수',
  'mine.start': '채굴 시작',
  'mine.stop': '채굴 중지',
  'mine.trayHint': '창을 닫아도 트레이에서 채굴이 계속돼요 — 트레이 아이콘으로 다시 열 수 있어요.',
  'mine.forget': '다른 계정 사용',
  'withdraw.title': '수익 인출',
  'withdraw.hint': '이 워커의 USDC 잔액을 내 지갑 주소(예: MetaMask 주소 복사)로 보냅니다. 돈을 옮길 땐 계정 비밀번호가 필요해요 — 워커 키만으로는 절대 인출할 수 없습니다. 현재는 테스트넷 USDC예요.',
  'withdraw.to': '받는 주소',
  'withdraw.password': '계정 비밀번호',
  'withdraw.submit': '인출',
}

let lang = localStorage.getItem('miner-lang') || 'en'

function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')
    if (lang === 'ko' && KO[key]) {
      if (!el.dataset.en) el.dataset.en = el.textContent
      el.textContent = KO[key]
    } else if (el.dataset.en) {
      el.textContent = el.dataset.en
    }
  })
  const toggle = document.getElementById('lang-toggle')
  if (toggle) toggle.textContent = lang === 'ko' ? 'English' : '한국어'
}

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

let walletTimer = null

async function refreshWallet() {
  try {
    const w = await invoke('get_wallet')
    const el = document.getElementById('stat-balance')
    if (w.usdc === null || w.usdc === undefined) {
      el.textContent = '—'
    } else {
      el.textContent = `$${w.usdc.toFixed(2)}`
    }
  } catch {
    /* wallet not provisioned yet or offline — leave the dash */
  }
  try {
    const card = await invoke('get_agent_card')
    document.getElementById('stat-credit').textContent = `${card.credit_score} · ${card.credit_rating}`
  } catch {
    /* card unavailable — leave the dash */
  }
}

// Buttons/listeners for the mining view are bound exactly once at boot —
// enterMiningView() (called on every view transition into it) only
// populates data, so re-entering never double-registers a handler.
function initMiningView() {
  document.getElementById('withdraw-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const errEl = document.getElementById('withdraw-error')
    const okEl = document.getElementById('withdraw-result')
    errEl.hidden = true
    okEl.hidden = true
    const btn = document.getElementById('withdraw-submit')
    btn.disabled = true
    btn.textContent = 'Withdrawing…'
    try {
      const to = document.getElementById('withdraw-to').value.trim()
      const password = document.getElementById('withdraw-password').value
      const r = await invoke('withdraw_earnings', { to, password })
      document.getElementById('withdraw-password').value = ''
      if (r.total_sent > 0) {
        const notes = r.results.filter((x) => x.error).map((x) => x.error)
        okEl.textContent = `Sent $${r.total_sent.toFixed(2)} to ${to.slice(0, 6)}…${to.slice(-4)}` + (notes.length ? ` (${notes.join('; ')})` : '')
        okEl.hidden = false
        appendLog(`Withdrew $${r.total_sent.toFixed(2)} to ${to.slice(0, 6)}…${to.slice(-4)}`)
        refreshWallet()
      } else {
        const notes = r.results.map((x) => x.error).filter(Boolean)
        errEl.textContent = notes.length ? notes.join('; ') : 'Nothing to withdraw yet.'
        errEl.hidden = false
      }
    } catch (err) {
      errEl.textContent = String(err)
      errEl.hidden = false
    } finally {
      btn.disabled = false
      btn.textContent = 'Withdraw'
    }
  })
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

  refreshWallet()
  if (!walletTimer) walletTimer = setInterval(refreshWallet, 60_000)
}

// ---------- Boot ----------

async function boot() {
  applyLang()
  document.getElementById('lang-toggle').addEventListener('click', () => {
    lang = lang === 'ko' ? 'en' : 'ko'
    localStorage.setItem('miner-lang', lang)
    applyLang()
  })

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
