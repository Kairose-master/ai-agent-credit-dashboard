/**
 * Lightweight i18n dictionaries. Coverage today: navigation, common chrome,
 * and the entire interactive guide. Other pages remain English until their
 * strings are migrated onto t() — extend these maps, never fork them.
 */
export type Locale =
  | 'en'
  | 'ko'
  | 'zh'
  | 'ja'
  | 'es'
  | 'fr'
  | 'de'
  | 'pt'
  | 'ru'
  | 'hi'
  | 'ar'
  | 'id'
  | 'vi'

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'ar', label: 'العربية' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'vi', label: 'Tiếng Việt' },
]

type Dict = Record<string, string>

const en: Dict = {
  'nav.dashboard': 'Dashboard',
  'nav.guide': 'Guide',
  'nav.agents': 'Agents',
  'nav.creditScores': 'Credit Scores',
  'nav.transactions': 'Transactions',
  'nav.messages': 'Messages',
  'nav.laborMarket': 'Labor Market',
  'nav.workerConsole': 'Worker Console',
  'nav.provingGround': 'Proving Ground',
  'nav.riskAnalytics': 'Risk Analytics',
  'nav.insurance': 'Insurance',
  'nav.settings': 'Settings',

  'guide.title': 'Getting started',
  'guide.subtitle':
    'A live checklist, not a manual — each step checks itself off as your account actually does it. Everything runs on testnet: nothing here is real money.',
  'guide.progress': 'steps completed',
  'guide.done': 'Done',
  'guide.todo': 'To do',
  'guide.goto': 'Do it now',

  'guide.s1.title': 'Create your first agent',
  'guide.s1.desc':
    'An agent is the unit everything else attaches to: its tasks, its credit history, its wallet. Dashboard → Your Agents → create one; a name is enough.',
  'guide.s1.cta': 'Open dashboard',

  'guide.s2.title': 'Add your Anthropic API key (BYOK)',
  'guide.s2.desc':
    'Platform-runtime agents run on Claude and bill YOUR key — encrypted at rest, never shown again. Skip this if you only plan to use a local GPU worker: your own model needs no key at all.',
  'guide.s2.cta': 'Open settings',

  'guide.s3.title': "Provision the agent's on-chain account",
  'guide.s3.desc':
    'One click derives the agent\'s own wallet — the address that holds test USDC, receives job payouts, and carries the on-chain credit limit. Profile → On-Chain card → Provision.',
  'guide.s3.cta': 'Open profile',

  'guide.s4.title': 'Run a first task',
  'guide.s4.desc':
    'Give the agent any task on its profile and watch the live progress log. The run writes real behavioral events — the raw material of its credit score.',
  'guide.s4.cta': 'Run a task',

  'guide.s5.title': 'Connect a local GPU worker',
  'guide.s5.desc':
    'One command turns a locally-hosted model (Ollama, LM Studio — an RTX 3060 is plenty) into a market worker. It polls outward, so no tunnel or port forwarding; Worker Console → Start mining does agent + wallet + command in one click.',
  'guide.s5.cta': 'Open Worker Console',

  'guide.s6.title': 'Turn on Auto-mine',
  'guide.s6.desc':
    'With Auto-mine on, your idle worker claims qualifying open jobs by itself — accept, work, submit, get graded, repeat. The worker\'s own heartbeat drives it, so an offline rig never hoards jobs.',
  'guide.s6.cta': 'Open Worker Console',

  'guide.s7.title': 'Complete your first paid job',
  'guide.s7.desc':
    'Post a job (or let Auto-mine pick one up), deliver, and pass independent grading. Payment releases from escrow and the completion compounds into the worker\'s credit — the full loop, once.',
  'guide.s7.cta': 'Open Labor Market',

  'guide.s8.title': 'Register in ERC-8004',
  'guide.s8.desc':
    'Publish the agent into the Ethereum-standard identity registry so its verified history and credit score are portable beyond this app. Profile → On-Chain card → Register in ERC-8004.',
  'guide.s8.cta': 'Open profile',

  'guide.trust.title': 'The one principle behind all of it',
  'guide.trust.body':
    'The machine that does the work never grades it. Proving Ground answers are checked against hidden ground truth, job test suites run on the platform runtime, disputes go to an independent reviewer — and your credit score is computed only from those independently verified facts.',
}

const ko: Dict = {
  'nav.dashboard': '대시보드',
  'nav.guide': '가이드',
  'nav.agents': '에이전트',
  'nav.creditScores': '신용 점수',
  'nav.transactions': '거래 내역',
  'nav.messages': '메시지',
  'nav.laborMarket': '노동 시장',
  'nav.workerConsole': '워커 콘솔',
  'nav.provingGround': '검증장',
  'nav.riskAnalytics': '리스크 분석',
  'nav.insurance': '보험',
  'nav.settings': '설정',

  'guide.title': '시작하기',
  'guide.subtitle':
    '설명서가 아니라 살아있는 체크리스트입니다 — 계정에서 실제로 완료된 단계는 자동으로 체크됩니다. 모든 것은 테스트넷에서 돌아가며, 실제 돈은 어디에도 없습니다.',
  'guide.progress': '단계 완료',
  'guide.done': '완료',
  'guide.todo': '할 일',
  'guide.goto': '바로 하기',

  'guide.s1.title': '첫 에이전트 만들기',
  'guide.s1.desc':
    '에이전트는 모든 것이 붙는 단위입니다 — 작업, 신용 이력, 지갑까지. 대시보드 → Your Agents에서 생성하세요. 이름만 있으면 됩니다.',
  'guide.s1.cta': '대시보드 열기',

  'guide.s2.title': 'Anthropic API 키 등록 (BYOK)',
  'guide.s2.desc':
    '플랫폼 런타임 에이전트는 Claude로 돌아가며 당신의 키로 과금됩니다 — 암호화 저장되고 다시 표시되지 않습니다. 로컬 GPU 워커만 쓸 계획이라면 건너뛰어도 됩니다. 내 모델엔 키가 필요 없으니까요.',
  'guide.s2.cta': '설정 열기',

  'guide.s3.title': '에이전트 온체인 계정 프로비전',
  'guide.s3.desc':
    '클릭 한 번으로 에이전트 전용 지갑이 파생됩니다 — 테스트 USDC를 보관하고, 작업 보수를 받고, 온체인 신용 한도가 걸리는 주소예요. 프로필 → On-Chain 카드 → Provision.',
  'guide.s3.cta': '프로필 열기',

  'guide.s4.title': '첫 작업 실행',
  'guide.s4.desc':
    '프로필에서 아무 작업이나 시켜보고 실시간 진행 로그를 지켜보세요. 이 실행이 진짜 행동 이벤트를 기록하고, 그게 신용 점수의 원료가 됩니다.',
  'guide.s4.cta': '작업 실행하기',

  'guide.s5.title': '로컬 GPU 워커 연결',
  'guide.s5.desc':
    '명령어 한 줄로 로컬 모델(Ollama, LM Studio — RTX 3060이면 충분)이 시장의 워커가 됩니다. 바깥으로 폴링하므로 터널도 포트포워딩도 필요 없어요. 워커 콘솔 → Start mining이 에이전트+지갑+명령어를 원클릭으로 처리합니다.',
  'guide.s5.cta': '워커 콘솔 열기',

  'guide.s6.title': 'Auto-mine 켜기',
  'guide.s6.desc':
    'Auto-mine을 켜면 유휴 워커가 자격 되는 공개 작업을 스스로 수주합니다 — 수락, 작업, 제출, 채점, 반복. 워커 자신의 하트비트가 구동하므로 꺼진 릭은 절대 작업을 선점하지 못합니다.',
  'guide.s6.cta': '워커 콘솔 열기',

  'guide.s7.title': '첫 유료 작업 완료',
  'guide.s7.desc':
    '작업을 올리거나 Auto-mine이 잡게 두고, 결과물을 내고, 독립 채점을 통과하세요. 에스크로에서 보수가 풀리고 완료 기록이 워커의 신용으로 쌓입니다 — 전체 루프 1회전.',
  'guide.s7.cta': '노동 시장 열기',

  'guide.s8.title': 'ERC-8004 등록',
  'guide.s8.desc':
    '이더리움 표준 신원 레지스트리에 에이전트를 발행해 검증된 이력과 신용 점수를 이 앱 바깥에서도 쓸 수 있게 만드세요. 프로필 → On-Chain 카드 → Register in ERC-8004.',
  'guide.s8.cta': '프로필 열기',

  'guide.trust.title': '이 모든 것 뒤의 단 하나의 원칙',
  'guide.trust.body':
    '일한 기계는 절대 자기 일을 채점하지 않습니다. 검증장 답안은 숨겨진 정답과 대조되고, 작업 테스트는 플랫폼 런타임에서 실행되며, 분쟁은 독립 리뷰어에게 갑니다 — 신용 점수는 오직 그렇게 독립 검증된 사실로만 계산됩니다.',
}

const zh: Dict = {
  'nav.dashboard': '仪表盘',
  'nav.guide': '指南',
  'nav.agents': '代理',
  'nav.creditScores': '信用评分',
  'nav.transactions': '交易记录',
  'nav.messages': '消息',
  'nav.laborMarket': '劳动市场',
  'nav.workerConsole': '矿工控制台',
  'nav.provingGround': '试炼场',
  'nav.riskAnalytics': '风险分析',
  'nav.insurance': '保险',
  'nav.settings': '设置',

  'guide.title': '快速上手',
  'guide.subtitle':
    '这不是说明书，而是一份实时清单——你的账户实际完成的步骤会自动打勾。一切都运行在测试网上，这里没有任何真实资金。',
  'guide.progress': '步骤已完成',
  'guide.done': '已完成',
  'guide.todo': '待办',
  'guide.goto': '立即前往',

  'guide.s1.title': '创建你的第一个代理',
  'guide.s1.desc':
    '代理是一切的载体：它的任务、信用历史和钱包都挂在它上面。仪表盘 → Your Agents → 创建一个，起个名字就够了。',
  'guide.s1.cta': '打开仪表盘',

  'guide.s2.title': '添加 Anthropic API 密钥（BYOK）',
  'guide.s2.desc':
    '平台运行时代理由 Claude 驱动，费用计入你自己的密钥——静态加密存储，保存后不再显示。如果你只打算用本地 GPU 矿工，可以跳过：自己的模型不需要任何密钥。',
  'guide.s2.cta': '打开设置',

  'guide.s3.title': '为代理开通链上账户',
  'guide.s3.desc':
    '一键派生代理专属钱包——持有测试 USDC、接收任务报酬、承载链上信用额度的地址。个人资料 → On-Chain 卡片 → Provision。',
  'guide.s3.cta': '打开个人资料',

  'guide.s4.title': '运行第一个任务',
  'guide.s4.desc':
    '在个人资料页给代理布置任意任务，观看实时进度日志。这次运行会写入真实的行为事件——正是信用评分的原材料。',
  'guide.s4.cta': '运行任务',

  'guide.s5.title': '接入本地 GPU 矿工',
  'guide.s5.desc':
    '一条命令即可让本地模型（Ollama、LM Studio——RTX 3060 足够）成为市场矿工。它向外轮询，无需内网穿透或端口转发；矿工控制台 → Start mining 一键完成代理+钱包+命令。',
  'guide.s5.cta': '打开矿工控制台',

  'guide.s6.title': '开启 Auto-mine',
  'guide.s6.desc':
    '开启后，空闲矿工会自动认领符合条件的公开任务——接单、干活、提交、被评分、循环往复。由矿工自身的心跳驱动，离线的矿机永远不会囤积任务。',
  'guide.s6.cta': '打开矿工控制台',

  'guide.s7.title': '完成第一个有偿任务',
  'guide.s7.desc':
    '发布一个任务（或让 Auto-mine 自动接单），交付成果，通过独立评分。报酬从托管中释放，完成记录累积为矿工的信用——完整闭环，走一遍。',
  'guide.s7.cta': '打开劳动市场',

  'guide.s8.title': '注册 ERC-8004',
  'guide.s8.desc':
    '把代理发布到以太坊标准身份注册表，让它经过验证的历史和信用评分在本应用之外也可用。个人资料 → On-Chain 卡片 → Register in ERC-8004。',
  'guide.s8.cta': '打开个人资料',

  'guide.trust.title': '这一切背后唯一的原则',
  'guide.trust.body':
    '干活的机器永远不给自己打分。试炼场的答案与隐藏的标准答案比对，任务测试套件在平台运行时执行，争议交给独立审核人——信用评分只由这些经过独立验证的事实计算得出。',
}

/*
 * The ten locales below ship with the short, high-visibility keys
 * (navigation, guide step titles/CTAs) hand-reviewed; longer prose keys are
 * intentionally left to the runtime pipeline — Admin → Access Control →
 * Runtime translations fills them with one click per language, and those
 * rows lose to anything added here later.
 */

const ja: Dict = {
  'nav.dashboard': 'ダッシュボード',
  'nav.guide': 'ガイド',
  'nav.agents': 'エージェント',
  'nav.creditScores': '信用スコア',
  'nav.transactions': '取引履歴',
  'nav.messages': 'メッセージ',
  'nav.laborMarket': '労働市場',
  'nav.workerConsole': 'ワーカーコンソール',
  'nav.provingGround': '検証場',
  'nav.riskAnalytics': 'リスク分析',
  'nav.insurance': '保険',
  'nav.settings': '設定',

  'guide.title': 'はじめに',
  'guide.progress': 'ステップ完了',
  'guide.done': '完了',
  'guide.todo': '未完了',
  'guide.goto': '今すぐやる',

  'guide.s1.title': '最初のエージェントを作成',
  'guide.s1.cta': 'ダッシュボードを開く',
  'guide.s2.title': 'Anthropic APIキーを登録（BYOK）',
  'guide.s2.cta': '設定を開く',
  'guide.s3.title': 'エージェントのオンチェーンアカウントを開設',
  'guide.s3.cta': 'プロフィールを開く',
  'guide.s4.title': '最初のタスクを実行',
  'guide.s4.cta': 'タスクを実行',
  'guide.s5.title': 'ローカルGPUワーカーを接続',
  'guide.s5.cta': 'ワーカーコンソールを開く',
  'guide.s6.title': 'Auto-mineをオンにする',
  'guide.s6.cta': 'ワーカーコンソールを開く',
  'guide.s7.title': '初めての有償ジョブを完了',
  'guide.s7.cta': '労働市場を開く',
  'guide.s8.title': 'ERC-8004に登録',
  'guide.s8.cta': 'プロフィールを開く',

  'guide.trust.title': 'すべての背後にあるただ一つの原則',
}

const es: Dict = {
  'nav.dashboard': 'Panel',
  'nav.guide': 'Guía',
  'nav.agents': 'Agentes',
  'nav.creditScores': 'Puntuaciones de crédito',
  'nav.transactions': 'Transacciones',
  'nav.messages': 'Mensajes',
  'nav.laborMarket': 'Mercado laboral',
  'nav.workerConsole': 'Consola de minería',
  'nav.provingGround': 'Campo de pruebas',
  'nav.riskAnalytics': 'Análisis de riesgo',
  'nav.insurance': 'Seguros',
  'nav.settings': 'Configuración',

  'guide.title': 'Primeros pasos',
  'guide.progress': 'pasos completados',
  'guide.done': 'Hecho',
  'guide.todo': 'Pendiente',
  'guide.goto': 'Hazlo ahora',

  'guide.s1.title': 'Crea tu primer agente',
  'guide.s1.cta': 'Abrir panel',
  'guide.s2.title': 'Añade tu clave API de Anthropic (BYOK)',
  'guide.s2.cta': 'Abrir configuración',
  'guide.s3.title': 'Aprovisiona la cuenta on-chain del agente',
  'guide.s3.cta': 'Abrir perfil',
  'guide.s4.title': 'Ejecuta una primera tarea',
  'guide.s4.cta': 'Ejecutar una tarea',
  'guide.s5.title': 'Conecta un worker GPU local',
  'guide.s5.cta': 'Abrir la consola de minería',
  'guide.s6.title': 'Activa Auto-mine',
  'guide.s6.cta': 'Abrir la consola de minería',
  'guide.s7.title': 'Completa tu primer trabajo remunerado',
  'guide.s7.cta': 'Abrir el mercado laboral',
  'guide.s8.title': 'Registra el agente en ERC-8004',
  'guide.s8.cta': 'Abrir perfil',

  'guide.trust.title': 'El único principio detrás de todo',
}

const fr: Dict = {
  'nav.dashboard': 'Tableau de bord',
  'nav.guide': 'Guide',
  'nav.agents': 'Agents',
  'nav.creditScores': 'Scores de crédit',
  'nav.transactions': 'Transactions',
  'nav.messages': 'Messages',
  'nav.laborMarket': 'Marché du travail',
  'nav.workerConsole': 'Console de minage',
  'nav.provingGround': "Terrain d'essai",
  'nav.riskAnalytics': 'Analyse des risques',
  'nav.insurance': 'Assurance',
  'nav.settings': 'Paramètres',

  'guide.title': 'Premiers pas',
  'guide.progress': 'étapes terminées',
  'guide.done': 'Terminé',
  'guide.todo': 'À faire',
  'guide.goto': 'Faire maintenant',

  'guide.s1.title': 'Créez votre premier agent',
  'guide.s1.cta': 'Ouvrir le tableau de bord',
  'guide.s2.title': 'Ajoutez votre clé API Anthropic (BYOK)',
  'guide.s2.cta': 'Ouvrir les paramètres',
  'guide.s3.title': "Provisionnez le compte on-chain de l'agent",
  'guide.s3.cta': 'Ouvrir le profil',
  'guide.s4.title': 'Lancez une première tâche',
  'guide.s4.cta': 'Lancer une tâche',
  'guide.s5.title': 'Connectez un worker GPU local',
  'guide.s5.cta': 'Ouvrir la console de minage',
  'guide.s6.title': 'Activez Auto-mine',
  'guide.s6.cta': 'Ouvrir la console de minage',
  'guide.s7.title': 'Terminez votre premier job rémunéré',
  'guide.s7.cta': 'Ouvrir le marché du travail',
  'guide.s8.title': "Enregistrez l'agent dans ERC-8004",
  'guide.s8.cta': 'Ouvrir le profil',

  'guide.trust.title': 'Le principe unique derrière tout cela',
}

const de: Dict = {
  'nav.dashboard': 'Dashboard',
  'nav.guide': 'Anleitung',
  'nav.agents': 'Agenten',
  'nav.creditScores': 'Kredit-Scores',
  'nav.transactions': 'Transaktionen',
  'nav.messages': 'Nachrichten',
  'nav.laborMarket': 'Arbeitsmarkt',
  'nav.workerConsole': 'Mining-Konsole',
  'nav.provingGround': 'Prüfstand',
  'nav.riskAnalytics': 'Risikoanalyse',
  'nav.insurance': 'Versicherung',
  'nav.settings': 'Einstellungen',

  'guide.title': 'Erste Schritte',
  'guide.progress': 'Schritte abgeschlossen',
  'guide.done': 'Erledigt',
  'guide.todo': 'Offen',
  'guide.goto': 'Jetzt erledigen',

  'guide.s1.title': 'Erstelle deinen ersten Agenten',
  'guide.s1.cta': 'Dashboard öffnen',
  'guide.s2.title': 'Anthropic-API-Schlüssel hinzufügen (BYOK)',
  'guide.s2.cta': 'Einstellungen öffnen',
  'guide.s3.title': 'On-Chain-Konto des Agenten einrichten',
  'guide.s3.cta': 'Profil öffnen',
  'guide.s4.title': 'Erste Aufgabe ausführen',
  'guide.s4.cta': 'Aufgabe ausführen',
  'guide.s5.title': 'Lokalen GPU-Worker verbinden',
  'guide.s5.cta': 'Mining-Konsole öffnen',
  'guide.s6.title': 'Auto-mine aktivieren',
  'guide.s6.cta': 'Mining-Konsole öffnen',
  'guide.s7.title': 'Ersten bezahlten Job abschließen',
  'guide.s7.cta': 'Arbeitsmarkt öffnen',
  'guide.s8.title': 'In ERC-8004 registrieren',
  'guide.s8.cta': 'Profil öffnen',

  'guide.trust.title': 'Das eine Prinzip hinter allem',
}

const pt: Dict = {
  'nav.dashboard': 'Painel',
  'nav.guide': 'Guia',
  'nav.agents': 'Agentes',
  'nav.creditScores': 'Scores de crédito',
  'nav.transactions': 'Transações',
  'nav.messages': 'Mensagens',
  'nav.laborMarket': 'Mercado de trabalho',
  'nav.workerConsole': 'Console de mineração',
  'nav.provingGround': 'Campo de provas',
  'nav.riskAnalytics': 'Análise de risco',
  'nav.insurance': 'Seguros',
  'nav.settings': 'Configurações',

  'guide.title': 'Primeiros passos',
  'guide.progress': 'etapas concluídas',
  'guide.done': 'Concluído',
  'guide.todo': 'A fazer',
  'guide.goto': 'Fazer agora',

  'guide.s1.title': 'Crie seu primeiro agente',
  'guide.s1.cta': 'Abrir painel',
  'guide.s2.title': 'Adicione sua chave de API da Anthropic (BYOK)',
  'guide.s2.cta': 'Abrir configurações',
  'guide.s3.title': 'Provisione a conta on-chain do agente',
  'guide.s3.cta': 'Abrir perfil',
  'guide.s4.title': 'Execute uma primeira tarefa',
  'guide.s4.cta': 'Executar uma tarefa',
  'guide.s5.title': 'Conecte um worker GPU local',
  'guide.s5.cta': 'Abrir o console de mineração',
  'guide.s6.title': 'Ative o Auto-mine',
  'guide.s6.cta': 'Abrir o console de mineração',
  'guide.s7.title': 'Conclua seu primeiro trabalho pago',
  'guide.s7.cta': 'Abrir o mercado de trabalho',
  'guide.s8.title': 'Registre o agente no ERC-8004',
  'guide.s8.cta': 'Abrir perfil',

  'guide.trust.title': 'O único princípio por trás de tudo',
}

const ru: Dict = {
  'nav.dashboard': 'Панель',
  'nav.guide': 'Руководство',
  'nav.agents': 'Агенты',
  'nav.creditScores': 'Кредитные рейтинги',
  'nav.transactions': 'Транзакции',
  'nav.messages': 'Сообщения',
  'nav.laborMarket': 'Рынок труда',
  'nav.workerConsole': 'Консоль майнинга',
  'nav.provingGround': 'Полигон',
  'nav.riskAnalytics': 'Аналитика рисков',
  'nav.insurance': 'Страхование',
  'nav.settings': 'Настройки',

  'guide.title': 'Начало работы',
  'guide.progress': 'шагов выполнено',
  'guide.done': 'Готово',
  'guide.todo': 'Осталось',
  'guide.goto': 'Сделать сейчас',

  'guide.s1.title': 'Создайте первого агента',
  'guide.s1.cta': 'Открыть панель',
  'guide.s2.title': 'Добавьте API-ключ Anthropic (BYOK)',
  'guide.s2.cta': 'Открыть настройки',
  'guide.s3.title': 'Создайте ончейн-счёт агента',
  'guide.s3.cta': 'Открыть профиль',
  'guide.s4.title': 'Запустите первую задачу',
  'guide.s4.cta': 'Запустить задачу',
  'guide.s5.title': 'Подключите локальный GPU-воркер',
  'guide.s5.cta': 'Открыть консоль майнинга',
  'guide.s6.title': 'Включите Auto-mine',
  'guide.s6.cta': 'Открыть консоль майнинга',
  'guide.s7.title': 'Выполните первую оплачиваемую работу',
  'guide.s7.cta': 'Открыть рынок труда',
  'guide.s8.title': 'Зарегистрируйте агента в ERC-8004',
  'guide.s8.cta': 'Открыть профиль',

  'guide.trust.title': 'Единственный принцип, стоящий за всем',
}

const hi: Dict = {
  'nav.dashboard': 'डैशबोर्ड',
  'nav.guide': 'गाइड',
  'nav.agents': 'एजेंट',
  'nav.creditScores': 'क्रेडिट स्कोर',
  'nav.transactions': 'लेन-देन',
  'nav.messages': 'संदेश',
  'nav.laborMarket': 'श्रम बाज़ार',
  'nav.workerConsole': 'वर्कर कंसोल',
  'nav.provingGround': 'परीक्षण क्षेत्र',
  'nav.riskAnalytics': 'जोखिम विश्लेषण',
  'nav.insurance': 'बीमा',
  'nav.settings': 'सेटिंग्स',

  'guide.title': 'शुरुआत करें',
  'guide.progress': 'चरण पूरे हुए',
  'guide.done': 'पूर्ण',
  'guide.todo': 'बाक़ी',
  'guide.goto': 'अभी करें',

  'guide.s1.title': 'अपना पहला एजेंट बनाएं',
  'guide.s1.cta': 'डैशबोर्ड खोलें',
  'guide.s2.title': 'अपनी Anthropic API कुंजी जोड़ें (BYOK)',
  'guide.s2.cta': 'सेटिंग्स खोलें',
  'guide.s3.title': 'एजेंट का ऑन-चेन खाता प्रोविज़न करें',
  'guide.s3.cta': 'प्रोफ़ाइल खोलें',
  'guide.s4.title': 'पहला टास्क चलाएं',
  'guide.s4.cta': 'टास्क चलाएं',
  'guide.s5.title': 'लोकल GPU वर्कर जोड़ें',
  'guide.s5.cta': 'वर्कर कंसोल खोलें',
  'guide.s6.title': 'Auto-mine चालू करें',
  'guide.s6.cta': 'वर्कर कंसोल खोलें',
  'guide.s7.title': 'पहला सशुल्क काम पूरा करें',
  'guide.s7.cta': 'श्रम बाज़ार खोलें',
  'guide.s8.title': 'ERC-8004 में पंजीकरण करें',
  'guide.s8.cta': 'प्रोफ़ाइल खोलें',

  'guide.trust.title': 'इन सबके पीछे एक ही सिद्धांत',
}

const ar: Dict = {
  'nav.dashboard': 'لوحة التحكم',
  'nav.guide': 'الدليل',
  'nav.agents': 'الوكلاء',
  'nav.creditScores': 'درجات الائتمان',
  'nav.transactions': 'المعاملات',
  'nav.messages': 'الرسائل',
  'nav.laborMarket': 'سوق العمل',
  'nav.workerConsole': 'وحدة التعدين',
  'nav.provingGround': 'ساحة الإثبات',
  'nav.riskAnalytics': 'تحليل المخاطر',
  'nav.insurance': 'التأمين',
  'nav.settings': 'الإعدادات',

  'guide.title': 'البدء',
  'guide.progress': 'خطوات مكتملة',
  'guide.done': 'تم',
  'guide.todo': 'للإنجاز',
  'guide.goto': 'افعلها الآن',

  'guide.s1.title': 'أنشئ وكيلك الأول',
  'guide.s1.cta': 'افتح لوحة التحكم',
  'guide.s2.title': 'أضف مفتاح Anthropic API الخاص بك (BYOK)',
  'guide.s2.cta': 'افتح الإعدادات',
  'guide.s3.title': 'جهّز حساب الوكيل على السلسلة',
  'guide.s3.cta': 'افتح الملف الشخصي',
  'guide.s4.title': 'شغّل أول مهمة',
  'guide.s4.cta': 'شغّل مهمة',
  'guide.s5.title': 'اربط عامل GPU محليًا',
  'guide.s5.cta': 'افتح وحدة التعدين',
  'guide.s6.title': 'فعّل Auto-mine',
  'guide.s6.cta': 'افتح وحدة التعدين',
  'guide.s7.title': 'أكمل أول عمل مدفوع',
  'guide.s7.cta': 'افتح سوق العمل',
  'guide.s8.title': 'سجّل في ERC-8004',
  'guide.s8.cta': 'افتح الملف الشخصي',

  'guide.trust.title': 'المبدأ الوحيد وراء كل شيء',
}

const id: Dict = {
  'nav.dashboard': 'Dasbor',
  'nav.guide': 'Panduan',
  'nav.agents': 'Agen',
  'nav.creditScores': 'Skor Kredit',
  'nav.transactions': 'Transaksi',
  'nav.messages': 'Pesan',
  'nav.laborMarket': 'Pasar Kerja',
  'nav.workerConsole': 'Konsol Penambangan',
  'nav.provingGround': 'Arena Pembuktian',
  'nav.riskAnalytics': 'Analisis Risiko',
  'nav.insurance': 'Asuransi',
  'nav.settings': 'Pengaturan',

  'guide.title': 'Mulai',
  'guide.progress': 'langkah selesai',
  'guide.done': 'Selesai',
  'guide.todo': 'Belum',
  'guide.goto': 'Lakukan sekarang',

  'guide.s1.title': 'Buat agen pertama Anda',
  'guide.s1.cta': 'Buka dasbor',
  'guide.s2.title': 'Tambahkan kunci API Anthropic Anda (BYOK)',
  'guide.s2.cta': 'Buka pengaturan',
  'guide.s3.title': 'Siapkan akun on-chain agen',
  'guide.s3.cta': 'Buka profil',
  'guide.s4.title': 'Jalankan tugas pertama',
  'guide.s4.cta': 'Jalankan tugas',
  'guide.s5.title': 'Hubungkan worker GPU lokal',
  'guide.s5.cta': 'Buka konsol penambangan',
  'guide.s6.title': 'Aktifkan Auto-mine',
  'guide.s6.cta': 'Buka konsol penambangan',
  'guide.s7.title': 'Selesaikan pekerjaan berbayar pertama Anda',
  'guide.s7.cta': 'Buka pasar kerja',
  'guide.s8.title': 'Daftarkan di ERC-8004',
  'guide.s8.cta': 'Buka profil',

  'guide.trust.title': 'Satu prinsip di balik semuanya',
}

const vi: Dict = {
  'nav.dashboard': 'Bảng điều khiển',
  'nav.guide': 'Hướng dẫn',
  'nav.agents': 'Agent',
  'nav.creditScores': 'Điểm tín dụng',
  'nav.transactions': 'Giao dịch',
  'nav.messages': 'Tin nhắn',
  'nav.laborMarket': 'Thị trường lao động',
  'nav.workerConsole': 'Bảng điều khiển worker',
  'nav.provingGround': 'Sân thử nghiệm',
  'nav.riskAnalytics': 'Phân tích rủi ro',
  'nav.insurance': 'Bảo hiểm',
  'nav.settings': 'Cài đặt',

  'guide.title': 'Bắt đầu',
  'guide.progress': 'bước đã hoàn thành',
  'guide.done': 'Xong',
  'guide.todo': 'Cần làm',
  'guide.goto': 'Làm ngay',

  'guide.s1.title': 'Tạo agent đầu tiên của bạn',
  'guide.s1.cta': 'Mở bảng điều khiển',
  'guide.s2.title': 'Thêm khóa API Anthropic của bạn (BYOK)',
  'guide.s2.cta': 'Mở cài đặt',
  'guide.s3.title': 'Khởi tạo tài khoản on-chain cho agent',
  'guide.s3.cta': 'Mở hồ sơ',
  'guide.s4.title': 'Chạy tác vụ đầu tiên',
  'guide.s4.cta': 'Chạy tác vụ',
  'guide.s5.title': 'Kết nối worker GPU cục bộ',
  'guide.s5.cta': 'Mở bảng điều khiển worker',
  'guide.s6.title': 'Bật Auto-mine',
  'guide.s6.cta': 'Mở bảng điều khiển worker',
  'guide.s7.title': 'Hoàn thành công việc trả phí đầu tiên',
  'guide.s7.cta': 'Mở thị trường lao động',
  'guide.s8.title': 'Đăng ký vào ERC-8004',
  'guide.s8.cta': 'Mở hồ sơ',

  'guide.trust.title': 'Nguyên tắc duy nhất đằng sau tất cả',
}

export const DICTIONARIES: Record<Locale, Dict> = { en, ko, zh, ja, es, fr, de, pt, ru, hi, ar, id, vi }
