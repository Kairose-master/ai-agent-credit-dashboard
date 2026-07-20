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
  'game.pet': '채굴 펫',
  'game.shop': '상점',
  'mine.imageToggle': '🖼️ 이미지 일감도 채굴 (무료 생성 API — 경쟁 적고 보수 좋은 레인)',
  'connect.title': '🔗 Claude / ChatGPT에서 Ledgermind 쓰기',
  'connect.hint': '이 계정은 MCP 커넥터로도 동작해요: Claude나 ChatGPT 대화 안에서 "10달러로 하청 줘"라고 위임하거나, 모델이 직접 일감을 수주해 USDC를 벌게 할 수 있어요. URL 하나면 되고 이 계정으로 승인합니다 — Claude 웹·Claude Desktop·ChatGPT(개발자 모드) 모두 지원.',
  'connect.open': '연결 가이드 열기',
  'delegate.title': '일감 맡기기 (다른 에이전트 고용)',
  'delegate.hint': '이번엔 반대편에 서 보세요: 목표를 적으면 플랫폼 플래너가 보수가 책정된 하위 작업으로 쪼개주고, 정확한 계획을 승인한 뒤에야 채굴로 번 USDC가 에스크로됩니다. 다른 에이전트들이 작업을 수행하고, 검수를 통과한 제출물엔 자동으로 지급되며 조립된 결과물이 아래에 표시됩니다.',
  'delegate.goal': '무엇을 맡기시겠어요?',
  'delegate.budget': '예산 (USDC)',
  'delegate.password': '계정 비밀번호',
  'delegate.plan': '하위 작업 설계 (돈 안 나감)',
  'delegate.review': '설계된 계획 — 승인해야만 돈이 움직입니다:',
  'delegate.confirm': '승인·게시 (보수 에스크로)',
  'delegate.discard': '버리기',
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

// ---------- Minigame: Miner Buddy ----------
//
// A game layer over the *real* mining stats — nothing here is simulated.
// Completed tasks grant XP (with a streak bonus), the pet evolves at level
// thresholds, and achievements unlock off task counts, streaks, balance and
// credit rating. State persists in localStorage so it survives restarts.

const GAME_KEY = 'miner-game-v1'

const PET_STAGES = [
  [1, '🥚'], [3, '🐣'], [5, '🤖'], [8, '🦾'], [12, '👑'], [16, '🐉'], [20, '🌟'],
]

const ACHIEVEMENTS = [
  { id: 'first_task', emoji: '🎯', en: 'First task completed', ko: '첫 작업 완료' },
  { id: 'tasks10', emoji: '⚒️', en: '10 tasks completed', ko: '작업 10개 완료' },
  { id: 'tasks50', emoji: '🏭', en: '50 tasks completed', ko: '작업 50개 완료' },
  { id: 'streak5', emoji: '🔥', en: '5-task streak', ko: '연속 5개 성공' },
  { id: 'streak10', emoji: '🌋', en: '10-task streak', ko: '연속 10개 성공' },
  { id: 'dollar1', emoji: '💵', en: 'First $1 earned', ko: '첫 $1 달성' },
  { id: 'dollar10', emoji: '💰', en: '$10 earned', ko: '$10 달성' },
  { id: 'level5', emoji: '⭐', en: 'Reached level 5', ko: '레벨 5 달성' },
  { id: 'level10', emoji: '🌟', en: 'Reached level 10', ko: '레벨 10 달성' },
  { id: 'credit_a', emoji: '🏆', en: 'A-tier credit rating', ko: '신용 A등급' },
]

// Idle-game economy: 💎 shards are a pure GAME currency (never USDC, never
// on-chain) earned from real completed tasks, streaks, quests, and petting
// the buddy. They buy multipliers (XP booster / shard magnet), streak
// insurance (combo shield) and cosmetics — the numbers that go up faster
// are still driven only by real mining.
const UPGRADES = [
  { id: 'xp', emoji: '⚡', en: 'XP Booster', ko: 'XP 부스터', max: 5, bonus: '+20% XP', cost: (t) => 60 * 2 ** t },
  { id: 'magnet', emoji: '🧲', en: 'Shard Magnet', ko: '조각 자석', max: 5, bonus: '+20% 💎', cost: (t) => 60 * 2 ** t },
]
const SHIELD = { cost: 80, max: 3 }
const HATS = [
  { id: 'cap', emoji: '⛑️', cost: 120 },
  { id: 'tophat', emoji: '🎩', cost: 300 },
  { id: 'crown', emoji: '👑', cost: 800 },
]
const QUESTS = [
  { id: 'q_tasks', goal: 3, reward: 40, en: 'Complete 3 tasks today', ko: '오늘 작업 3개 완료', progress: (s) => s.tasksToday },
  { id: 'q_streak', goal: 4, reward: 30, en: 'Reach a 4-task streak', ko: '연속 4개 성공', progress: (s) => s.streak },
  { id: 'q_clicks', goal: 20, reward: 20, en: 'Pet your buddy 20 times', ko: '펫 20번 쓰다듬기', progress: (s) => s.clicksToday },
]

function loadGame() {
  let raw = null
  try {
    const parsed = JSON.parse(localStorage.getItem(GAME_KEY))
    if (parsed && typeof parsed.xp === 'number') raw = parsed
  } catch { /* corrupted state — start over */ }
  // v1 saves lack the idle-economy fields — fill defaults, keep progress.
  return Object.assign(
    {
      xp: 0, level: 1, total: 0, streak: 0, best: 0, ach: {},
      shards: 0, upgrades: { xp: 0, magnet: 0 }, shields: 0,
      hats: [], hat: null,
      day: '', tasksToday: 0, clicksToday: 0, questsClaimed: [],
      lastSeen: null,
    },
    raw || {},
  )
}

const game = loadGame()

/** Daily rollover for quest counters — called before anything reads them. */
function rollDay() {
  const today = new Date().toISOString().slice(0, 10)
  if (game.day !== today) {
    game.day = today
    game.tasksToday = 0
    game.clicksToday = 0
    game.questsClaimed = []
  }
}

function saveGame() {
  localStorage.setItem(GAME_KEY, JSON.stringify(game))
}

// XP needed to go from `level` to `level + 1`.
function xpNeeded(level) {
  return 50 + (level - 1) * 25
}

function petForLevel(level) {
  let sprite = PET_STAGES[0][1]
  for (const [min, emoji] of PET_STAGES) if (level >= min) sprite = emoji
  return sprite
}

// Queued toasts: multiple events at once (boot achievements + away
// earnings, level-up + quest) show one after another instead of the last
// writer silently eating the rest.
const toastQueue = []
let toastShowing = false

function showToast(message) {
  toastQueue.push(message)
  if (!toastShowing) nextToast()
}

function nextToast() {
  const el = document.getElementById('toast')
  const message = toastQueue.shift()
  if (message === undefined) {
    toastShowing = false
    el.hidden = true
    return
  }
  toastShowing = true
  el.textContent = message
  el.hidden = false
  setTimeout(nextToast, 2600)
}

function unlock(id) {
  if (game.ach[id]) return
  const def = ACHIEVEMENTS.find((a) => a.id === id)
  if (!def) return
  game.ach[id] = Date.now()
  saveGame()
  const name = lang === 'ko' ? def.ko : def.en
  const label = lang === 'ko' ? '업적 달성' : 'Achievement unlocked'
  showToast(`${def.emoji} ${label}: ${name}`)
  appendLog(`🏅 ${label}: ${name}`)
  renderGame()
}

function bouncePet() {
  const el = document.getElementById('pet-sprite')
  el.classList.remove('bounce')
  void el.offsetWidth // restart the CSS animation
  el.classList.add('bounce')
}

function addXp(amount) {
  game.xp += amount
  let leveled = false
  while (game.xp >= xpNeeded(game.level)) {
    game.xp -= xpNeeded(game.level)
    game.level += 1
    leveled = true
  }
  if (leveled) {
    const msg = lang === 'ko'
      ? `${petForLevel(game.level)} 레벨 업! Lv.${game.level}`
      : `${petForLevel(game.level)} Level up! Now Lv.${game.level}`
    showToast(msg)
    appendLog(`🎉 ${msg}`)
    if (game.level >= 5) unlock('level5')
    if (game.level >= 10) unlock('level10')
  }
}

function xpMultiplier() {
  return 1 + 0.2 * (game.upgrades?.xp ?? 0)
}
function shardMultiplier() {
  return 1 + 0.2 * (game.upgrades?.magnet ?? 0)
}

function gainShards(base) {
  const amount = Math.round(base * shardMultiplier())
  game.shards += amount
  return amount
}

function onTaskDone() {
  rollDay()
  game.total += 1
  game.tasksToday += 1
  game.streak += 1
  if (game.streak > game.best) game.best = game.streak
  // 10 XP per task + streak bonus (2 XP per consecutive task, capped at +20)
  addXp(Math.round((10 + Math.min((game.streak - 1) * 2, 20)) * xpMultiplier()))
  const got = gainShards(5 + Math.min(game.streak, 10))
  floatOverPet(`+${got} 💎`)
  unlock('first_task')
  if (game.total >= 10) unlock('tasks10')
  if (game.total >= 50) unlock('tasks50')
  if (game.streak >= 5) unlock('streak5')
  if (game.streak >= 10) unlock('streak10')
  checkQuests()
  saveGame()
  renderGame()
  bouncePet()
}

function onTaskFail() {
  rollDay()
  if (game.streak >= 2 && game.shields > 0) {
    // Combo shield: one bought insurance eats the failure, streak survives.
    game.shields -= 1
    showToast(lang === 'ko' ? `🛡️ 콤보 보호! 연속 ${game.streak} 유지 (남은 보호 ${game.shields})` : `🛡️ Combo shielded! Streak of ${game.streak} survives (${game.shields} left)`)
  } else {
    game.streak = 0
  }
  addXp(1) // consolation XP — the model did try
  gainShards(1)
  saveGame()
  renderGame()
}

/** Small floating reward text rising off the pet — the juice that makes
 *  earning feel like earning. */
function floatOverPet(text) {
  const wrap = document.getElementById('pet-wrap')
  if (!wrap) return
  const el = document.createElement('span')
  el.className = 'float-reward'
  el.textContent = text
  wrap.appendChild(el)
  setTimeout(() => el.remove(), 1100)
}

let lastPetClick = 0

function onPetClick() {
  const now = Date.now()
  if (now - lastPetClick < 1500) return // petting cooldown
  lastPetClick = now
  rollDay()
  game.clicksToday += 1
  const got = gainShards(1)
  floatOverPet(`+${got} 💎`)
  bouncePet()
  checkQuests()
  saveGame()
  renderGame()
}

function checkQuests() {
  rollDay()
  for (const q of QUESTS) {
    if (game.questsClaimed.includes(q.id)) continue
    if (q.progress(game) >= q.goal) {
      game.questsClaimed.push(q.id)
      game.shards += q.reward // quest rewards skip the magnet — fixed prizes
      const name = lang === 'ko' ? q.ko : q.en
      showToast(lang === 'ko' ? `📜 퀘스트 완료: ${name} +${q.reward}💎` : `📜 Quest complete: ${name} +${q.reward}💎`)
    }
  }
}

function buy(kind, id) {
  rollDay()
  if (kind === 'upgrade') {
    const def = UPGRADES.find((u) => u.id === id)
    const tier = game.upgrades[id] ?? 0
    if (tier >= def.max) return
    const cost = def.cost(tier)
    if (game.shards < cost) return
    game.shards -= cost
    game.upgrades[id] = tier + 1
  } else if (kind === 'shield') {
    if (game.shields >= SHIELD.max || game.shards < SHIELD.cost) return
    game.shards -= SHIELD.cost
    game.shields += 1
  } else if (kind === 'hat') {
    const def = HATS.find((h) => h.id === id)
    if (game.hats.includes(id)) {
      game.hat = game.hat === id ? null : id // owned: click toggles wearing it
    } else {
      if (game.shards < def.cost) return
      game.shards -= def.cost
      game.hats.push(id)
      game.hat = id
    }
  }
  saveGame()
  renderGame()
}

function renderGame() {
  const panel = document.getElementById('game-panel')
  if (!panel) return
  rollDay()
  document.getElementById('pet-sprite').textContent = petForLevel(game.level)
  document.getElementById('pet-level').textContent = `Lv.${game.level}`
  document.getElementById('shard-count').textContent = String(game.shards)

  const hatEl = document.getElementById('pet-hat')
  const hatDef = HATS.find((h) => h.id === game.hat)
  hatEl.hidden = !hatDef
  hatEl.textContent = hatDef ? hatDef.emoji : ''

  const streakEl = document.getElementById('pet-streak')
  streakEl.hidden = game.streak < 2
  streakEl.textContent = `🔥×${game.streak}` + (game.shields > 0 ? ` 🛡️×${game.shields}` : '')

  const need = xpNeeded(game.level)
  document.getElementById('xp-fill').style.width = `${Math.min(100, (game.xp / need) * 100)}%`
  document.getElementById('xp-text').textContent = `${game.xp} / ${need} XP`

  renderQuests()
  renderShop()

  const badges = document.getElementById('badges')
  badges.innerHTML = ''
  for (const a of ACHIEVEMENTS) {
    const span = document.createElement('span')
    const unlocked = Boolean(game.ach[a.id])
    span.className = unlocked ? 'badge' : 'badge locked'
    span.textContent = a.emoji
    span.title = lang === 'ko' ? a.ko : a.en
    badges.appendChild(span)
  }
}

function renderQuests() {
  const wrap = document.getElementById('quests')
  wrap.innerHTML = ''
  for (const q of QUESTS) {
    const done = game.questsClaimed.includes(q.id)
    const cur = Math.min(q.progress(game), q.goal)
    const line = document.createElement('div')
    line.className = done ? 'quest done' : 'quest'
    line.textContent = `${done ? '✅' : '⬜'} ${lang === 'ko' ? q.ko : q.en} — ${cur}/${q.goal} (+${q.reward}💎)`
    wrap.appendChild(line)
  }
}

function shopRow(labelText, note, canBuy, onClick) {
  const row = document.createElement('div')
  row.className = 'shop-row'
  const label = document.createElement('span')
  label.textContent = labelText
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'shop-buy'
  btn.textContent = note
  btn.disabled = !canBuy
  btn.addEventListener('click', onClick)
  row.appendChild(label)
  row.appendChild(btn)
  return row
}

function renderShop() {
  const shop = document.getElementById('shop')
  if (shop.hidden) return
  shop.innerHTML = ''
  const ko = lang === 'ko'

  for (const u of UPGRADES) {
    const tier = game.upgrades[u.id] ?? 0
    const maxed = tier >= u.max
    shop.appendChild(shopRow(
      `${u.emoji} ${ko ? u.ko : u.en} ${tier}/${u.max} (${u.bonus})`,
      maxed ? (ko ? '최대' : 'MAX') : `${u.cost(tier)}💎`,
      !maxed && game.shards >= u.cost(tier),
      () => buy('upgrade', u.id),
    ))
  }

  shop.appendChild(shopRow(
    `🛡️ ${ko ? '콤보 보호막 (실패 1회 무효)' : 'Combo shield (absorbs one failure)'} ${game.shields}/${SHIELD.max}`,
    game.shields >= SHIELD.max ? (ko ? '최대' : 'MAX') : `${SHIELD.cost}💎`,
    game.shields < SHIELD.max && game.shards >= SHIELD.cost,
    () => buy('shield'),
  ))

  for (const h of HATS) {
    const owned = game.hats.includes(h.id)
    const wearing = game.hat === h.id
    shop.appendChild(shopRow(
      `${h.emoji} ${ko ? '모자' : 'Hat'}${wearing ? (ko ? ' (착용 중)' : ' (wearing)') : ''}`,
      owned ? (wearing ? (ko ? '벗기' : 'Take off') : (ko ? '착용' : 'Wear')) : `${h.cost}💎`,
      owned || game.shards >= h.cost,
      () => buy('hat', h.id),
    ))
  }
}

/** "Welcome back" summary — the idle-game payoff moment. Balance is real
 *  (from the platform), so the number is honest. */
let awayChecked = false

function checkAwayEarnings(usdc) {
  if (awayChecked) return
  awayChecked = true
  const seen = game.lastSeen
  if (seen && typeof seen.usdc === 'number' && Date.now() - seen.at > 30 * 60_000) {
    const delta = usdc - seen.usdc
    if (delta > 0.005) {
      showToast(lang === 'ko'
        ? `⛏️ 자리 비운 동안 $${delta.toFixed(2)} 벌었어요!`
        : `⛏️ Your miner earned $${delta.toFixed(2)} while you were away!`)
    }
  }
}

// Wire real stat deltas into the game. Counters come from the Rust mining
// loop as running totals per app run, so we diff against the last seen
// values (and re-sync if they ever go backwards, e.g. after a restart).
let prevCompleted = null
let prevFailed = null

function gameOnStatus(completed, failed) {
  if (prevCompleted === null) {
    prevCompleted = completed
    prevFailed = failed
    return
  }
  if (completed < prevCompleted || failed < prevFailed) {
    prevCompleted = completed
    prevFailed = failed
    return
  }
  for (let i = prevCompleted; i < completed; i++) onTaskDone()
  for (let i = prevFailed; i < failed; i++) onTaskFail()
  prevCompleted = completed
  prevFailed = failed
}

function gameOnWallet(usdc) {
  if (usdc >= 1) unlock('dollar1')
  if (usdc >= 10) unlock('dollar10')
  checkAwayEarnings(usdc)
  game.lastSeen = { usdc, at: Date.now() }
  saveGame()
}

function gameOnCredit(rating) {
  if (typeof rating === 'string' && rating.startsWith('A')) unlock('credit_a')
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
    gameOnStatus(payload.tasks_completed, payload.tasks_failed)

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
      gameOnWallet(w.usdc)
    }
  } catch {
    /* wallet not provisioned yet or offline — leave the dash */
  }
  try {
    const card = await invoke('get_agent_card')
    document.getElementById('stat-credit').textContent = `${card.credit_score} · ${card.credit_rating}`
    gameOnCredit(card.credit_rating)
  } catch {
    /* card unavailable — leave the dash */
  }
}

// ---------- Delegation (requester side) ----------

let currentPlanId = null
let delegateTimer = null

function delegateMsg(okText, errText) {
  const ok = document.getElementById('delegate-ok')
  const err = document.getElementById('delegate-error')
  ok.hidden = !okText
  ok.textContent = okText || ''
  err.hidden = !errText
  err.textContent = errText || ''
}

const JOB_STATUS_ICON = {
  Open: '🕐', Claimed: '⚙️', Submitted: '📤', Completed: '✅', Refunded: '↩️', Disputed: '⚠️',
}

function renderPlanReview(subtasks) {
  const list = document.getElementById('delegate-plan-list')
  list.innerHTML = ''
  for (const st of subtasks) {
    const li = document.createElement('li')
    li.textContent = `$${Number(st.bountyUsd).toFixed(2)} — ${st.title}`
    li.title = st.description
    list.appendChild(li)
  }
  document.getElementById('delegate-plan-review').hidden = false
}

function renderDelegations(delegations) {
  const wrap = document.getElementById('delegate-list')
  wrap.innerHTML = ''
  for (const d of delegations) {
    if (d.status === 'planned' && d.id !== currentPlanId) continue // stale unconfirmed plans from other sessions
    const card = document.createElement('div')
    card.className = 'dlg-card'

    const head = document.createElement('div')
    head.className = 'dlg-head'
    const statusKo = { planned: '계획됨', posted: '진행 중', completed: '완료', failed: '실패' }
    const label = lang === 'ko' ? (statusKo[d.status] || d.status) : d.status
    head.innerHTML = `<span class="dlg-status dlg-${d.status}">${label}</span> <span class="dlg-budget">$${d.budget_usd.toFixed(2)}</span>`
    card.appendChild(head)

    const task = document.createElement('div')
    task.className = 'dlg-task'
    task.textContent = d.task.length > 120 ? d.task.slice(0, 120) + '…' : d.task
    card.appendChild(task)

    if (d.status !== 'planned') {
      for (const st of d.subtasks) {
        const line = document.createElement('div')
        line.className = 'dlg-subtask'
        const icon = st.failed ? '❌' : (JOB_STATUS_ICON[st.jobStatus] || '🕐')
        const worker = st.workerLabel ? ` · ${st.workerLabel}` : ''
        line.textContent = `${icon} ${st.title} — $${Number(st.bountyUsd).toFixed(2)}${worker}`
        card.appendChild(line)
      }
    }

    if (d.final_output) {
      const det = document.createElement('details')
      const sum = document.createElement('summary')
      sum.textContent = lang === 'ko' ? '최종 결과물 보기' : 'View final output'
      const pre = document.createElement('pre')
      pre.className = 'dlg-output'
      pre.textContent = d.final_output
      det.appendChild(sum)
      det.appendChild(pre)
      card.appendChild(det)
    }
    if (d.error) {
      const err = document.createElement('div')
      err.className = 'error'
      err.textContent = d.error
      card.appendChild(err)
    }
    wrap.appendChild(card)
  }
}

async function refreshDelegations() {
  try {
    const res = await invoke('delegation_status')
    renderDelegations(res.delegations || [])
  } catch {
    /* offline or platform hiccup — keep the last rendering */
  }
}

function initDelegateView() {
  const section = document.getElementById('delegate-section')

  // Poll only while the panel is open — each poll also drives the
  // platform's verification tick, so an open panel IS the heartbeat.
  section.addEventListener('toggle', () => {
    if (section.open) {
      refreshDelegations()
      if (!delegateTimer) delegateTimer = setInterval(refreshDelegations, 12_000)
    } else if (delegateTimer) {
      clearInterval(delegateTimer)
      delegateTimer = null
    }
  })

  document.getElementById('delegate-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    delegateMsg('', '')
    const btn = document.getElementById('delegate-plan-btn')
    btn.disabled = true
    try {
      const goal = document.getElementById('delegate-goal').value.trim()
      const budgetUsd = Number(document.getElementById('delegate-budget').value)
      const password = document.getElementById('delegate-password').value
      const res = await invoke('plan_delegation', { goal, budgetUsd, password })
      currentPlanId = res.id
      renderPlanReview(res.subtasks || [])
    } catch (err) {
      delegateMsg('', String(err))
    } finally {
      btn.disabled = false
    }
  })

  document.getElementById('delegate-confirm-btn').addEventListener('click', async () => {
    if (!currentPlanId) return
    delegateMsg('', '')
    const btn = document.getElementById('delegate-confirm-btn')
    btn.disabled = true
    try {
      const password = document.getElementById('delegate-password').value
      const res = await invoke('confirm_delegation', { id: currentPlanId, password })
      document.getElementById('delegate-plan-review').hidden = true
      document.getElementById('delegate-goal').value = ''
      delegateMsg(lang === 'ko' ? `하위 작업 ${res.posted}건 게시 완료 — 아래에서 진행 상황을 확인하세요.` : `Posted ${res.posted} subtasks — track progress below.`, '')
      currentPlanId = null
      refreshDelegations()
    } catch (err) {
      delegateMsg('', String(err))
    } finally {
      btn.disabled = false
    }
  })

  document.getElementById('delegate-discard-btn').addEventListener('click', async () => {
    if (!currentPlanId) return
    try {
      const password = document.getElementById('delegate-password').value
      await invoke('discard_delegation', { id: currentPlanId, password })
    } catch { /* already gone is fine */ }
    currentPlanId = null
    document.getElementById('delegate-plan-review').hidden = true
    refreshDelegations()
  })
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

  // Image-mining toggle: declares/undeclares the 'image' capability on
  // the platform so the matcher (auto-mine) routes image jobs here.
  document.getElementById('image-mining-toggle').addEventListener('change', async (e) => {
    const box = e.target
    const errEl = document.getElementById('image-mining-error')
    errEl.hidden = true
    box.disabled = true
    try {
      await invoke('set_image_mining', { enabled: box.checked })
      appendLog(box.checked
        ? 'Image mining ON — this agent now claims image jobs too (free generation API).'
        : 'Image mining OFF — back to text-only.')
    } catch (err) {
      box.checked = !box.checked // revert — platform didn't accept it
      errEl.textContent = String(err)
      errEl.hidden = false
    } finally {
      box.disabled = false
    }
  })

  document.getElementById('connect-open-btn').addEventListener('click', async () => {
    try {
      await invoke('open_url', { url: 'https://ai-agent-credit-dashboard.vercel.app/connect' })
    } catch (err) {
      appendLog(`Could not open browser: ${err}`)
    }
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
  document.getElementById('image-mining-toggle').checked = Boolean(cfg.image_mining)

  renderGame()
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
    renderGame() // badge tooltips follow the language
  })

  await initRegisterView()
  initBackendView()
  initMiningView()
  initDelegateView()

  document.getElementById('pet-wrap').addEventListener('click', onPetClick)
  document.getElementById('shop-toggle').addEventListener('click', () => {
    const shop = document.getElementById('shop')
    shop.hidden = !shop.hidden
    renderShop()
  })

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
