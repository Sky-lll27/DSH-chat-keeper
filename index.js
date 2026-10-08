/**
 * DSH 对话管理器插件（Conversation Manager）
 * =========================================
 *
 * 形态：一个导出 `apply` 的 ESM 模块 —— 这正是 DSH 插件的契约
 * （`export const name` + `export const inject` + `export function apply(ctx, config)`）。
 * 能力全部通过 `ctx` 注册，注册即「可逆效果」，插件卸载/热替换时由 Cordis 自动清理。
 *
 * 它做什么：
 *   1. 订阅会话与 agent 的生命周期事件，维护一份轻量的对话索引
 *      （标题、工作目录、轮次、消息数、token 用量、存活/运行状态）。
 *   2. 通过 `ctx.tools.register` 把「列出/查看/检索/统计/打标签/派生」注册成模型可调用的工具。
 *   3. 通过 `ctx.provide` 暴露 `conversationManager` 服务，供其它插件消费。
 *
 * 为什么零外部 import：插件通过 `--patch` 用绝对路径挂载时，Node 的裸模块解析
 * 走不到 harness 自己的 `node_modules`，任何 `import '@deepseek-ai/...'` 都会让加载失败。
 * 这里只依赖 `ctx` 表面与 Node 内建模块，因此放在任何目录都能加载。
 *
 * 事件与服务的取舍：`tools`/`sessions`/`agents` 是 core 组合必然启动的服务，写进
 * `inject` 可以拿到加载顺序保证；`sessionController`（宿主会话 API）不是每个组合都有，
 * 所以用 `ctx.get()` 按需探测，缺失时工具会如实报告降级原因。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { ConversationIndex, sessionId as sessionIdOf, view } from './lib/conversations.js'
import { registerConversationTools } from './lib/tools.js'
import { refreshTrashMirrors } from './lib/trash-mirror.js'
import { refreshHostStatus } from './lib/host-status.js'
import { resolveDshHome } from './lib/cleanup.js'
import { createCjkScanner, installCjkSearchAll } from './lib/search-cjk.js'
import { isCoreEventType, safe } from './lib/events.js'

/** 插件唯一标识。 */
export const name = 'conversation-manager'

/** 声明依赖的服务；这些服务在 apply 执行时保证已就绪。 */
export const inject = ['tools', 'sessions', 'agents']

const DEFAULTS = {
  /** 索引里最多保留多少条对话记录（超出后淘汰最久未活动的非存活记录）。 */
  maxTracked: 500,
  /** 自动标题的最大字符数。 */
  titleMax: 80,
  /**
   * 是否允许用已弃用的 `session.snapshotEvents()` 做一次全量深扫。
   * 发布代码把该读法标记为「禁止新增生产调用」，所以默认关闭；
   * 开启后能补出轮次数、usage 与更准的时间戳（这些不在 Message 里）。
   */
  deepScan: false,
  /** 非空时把索引快照写入该文件，重启后可以继续看到历史对话的元数据。 */
  persistPath: '',
  /** 写文件的防抖间隔（毫秒）。 */
  saveDebounceMs: 1000,
  /**
   * 是否把「回收站概览」镜像写进各存活会话的工作区（`.dsh-conversation-manager/trash.json`）。
   *
   * 为什么需要：Web 面板读不到 DSH_HOME，只能读会话工作区内的文件；
   * 镜像只含批次名/时间/条数/大小，**不含任何对话正文或标题**。
   * 不想让本插件往你的工程目录里写文件时，把它设为 false（面板会显示"镜像未开启"）。
   */
  trashMirror: true,
  /**
   * 是否把**宿主状态快照**（`.dsh-conversation-manager/status.json`）写进各存活会话的工作区。
   *
   * 它是给"装没装上"准备的验收凭证：只含插件版本、补丁目标状态与计数，
   * **不含任何对话内容或用户输入**。0.5.0 就是因为没有它，包错了对象却没人发现。
   * 设为 false 就不写这一份（回收站镜像仍受 `trashMirror` 控制）。
   */
  statusFile: true,
  /**
   * 中文查询的字面兜底：官方内容索引按词元匹配（分词器 `unicode61` 写死在建表语句里），
   * 中文子串经常搜不到。开启后，查询含中日韩文字时本插件会**额外**读磁盘做一次
   * 字面子串扫描并把命中合并进结果；纯英文查询完全不走这条路，行为与从前一致。
   * 设为 false 就彻底交还给官方索引。
   */
  cjkSearch: true,
  /** 兜底扫描的时间预算（毫秒）。扫描是同步读日志，预算越大界面可能顿得越久。 */
  cjkSearchBudgetMs: 2000,
  /** 兜底扫描最多读几个对话（按最近活动倒序，先搜最可能相关的）。 */
  cjkSearchMaxConversations: 120,
}

/**
 * 插件入口。
 * @param {object} ctx Cordis 上下文
 * @param {object} [config] cordis 配置（本插件不导出 Config schema，因此这里全部有默认值）
 */
export function apply(ctx, config) {
  const settings = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  const index = new ConversationIndex({
    maxTracked: settings.maxTracked,
    titleMax: settings.titleMax,
    deepScan: settings.deepScan,
  })
  const sessions = ctx.sessions ?? ctx.get?.('sessions')
  const agents = ctx.agents ?? ctx.get?.('agents')
  // 这个快照只用于自检报告；真正调用改名服务时用的是下面的惰性解析器，
  // 以免 apply 早于该服务注册、导致持久化分支永远走降级路径。
  const sessionController = safe(() => ctx.get?.('sessionController'))
  const log = makeLogger(ctx)

  // ── 自检账本 ──────────────────────────────────────────────────────────────
  // 本插件是在「无法执行任何命令」的环境里写的，因此把「宿主到底长什么样」记录下来，
  // 挂载后由 conversation_selftest 工具一次性对账，而不是靠猜。
  const diag = {
    startedAt: Date.now(),
    providedVia: 'unknown',
    injected: {
      tools: Boolean(ctx.tools),
      sessions: Boolean(sessions),
      agents: Boolean(agents),
      sessionController: Boolean(sessionController),
    },
    handlers: {
      'session/created': 0,
      'session/disposed': 0,
      'session/event': 0,
      'agent/created': 0,
      'agent/disposed': 0,
      'agent/status': 0,
    },
    eventTypes: new Set(),
    sampleEvents: {},
    /** 命中核心投影词表的事件条数——判断「词表是否对得上」的唯一依据。 */
    coreTypesSeen: 0,
    /** 已观测到的、由各插件合并扩展进来的合法事件类型。 */
    extensionTypes: new Set(),
    /** 词表告警只发一次。 */
    vocabularyWarned: false,
    /** 加载期观察到的问题（例如 list() 返回了非数组）。 */
    notes: [],
  }

  // ── 可选：持久化索引元数据 ────────────────────────────────────────────────
  const persistence = createPersistence(settings, index, log)
  persistence.load()

  // ── 宿主状态快照（验收凭证，见 lib/host-status.js）────────────────────────
  // 只写插件版本与自检账本，不写任何会话内容；由 trashMirror / statusFile 两个开关控制。
  // 有了它，"补丁到底装在哪个对象上"不必再靠模型调工具才看得到 —— 0.5.0 就是栽在这。
  const pluginVersion = readPluginVersion()
  const statusEnabled = () => settings.trashMirror !== false && settings.statusFile !== false
  /** 是否已经成功落过盘：保证"至少写出一次"，不依赖 apply 时列表恰好非空。 */
  let statusWritten = false
  const liveCwds = () => [...index.sessions.values()]
    .map((session) => safe(() => session?.header?.cwd))
    .filter((cwd) => typeof cwd === 'string' && cwd !== '')
  function writeHostStatus(extraCwds = []) {
    if (!statusEnabled()) return
    const cwds = [...new Set([...liveCwds(), ...extraCwds].filter((cwd) => typeof cwd === 'string' && cwd !== ''))]
    if (cwds.length === 0) return
    const result = safe(() => refreshHostStatus(cwds, {
      plugin: name,
      version: pluginVersion,
      // cjkDiag 在下方声明：本函数只在事件与 apply 后半段被调用，那时它已初始化。
      cjkSearch: { ...cjkDiag },
    }))
    if ((result?.written?.length ?? 0) > 0) statusWritten = true
  }

  // ── 生命周期追踪 ──────────────────────────────────────────────────────────
  // 全部通过 ctx.on 注册，卸载时自动移除；回调内部一律不抛异常。
  ctx.on('session/created', (session) => {
    diag.handlers['session/created'] += 1
    index.upsert(session)
    persistence.schedule()
    notify('session-created', { id: safe(() => session?.id) })
    // 新会话一出现就给它所在的工作区写一份回收站镜像，面板随即能读到内容。
    if (settings.trashMirror !== false) {
      // 注意：应用主进程里没有 DSH_HOME 环境变量，必须走带存在性校验的解析。
      const home = resolveDshHome(safe(() => process.env.DSH_HOME)).home
      const cwd = safe(() => session?.header?.cwd)
      if (typeof home === 'string' && home !== '' && typeof cwd === 'string' && cwd !== '') {
        safe(() => refreshTrashMirrors(home, [cwd]))
      }
    }
    // 顺手把宿主状态快照也补一份给这个新工作区（验收凭证，见 lib/host-status.js）。
    writeHostStatus([safe(() => session?.header?.cwd)])
  })

  ctx.on('session/disposed', (session) => {
    diag.handlers['session/disposed'] += 1
    index.markDisposed(session)
    persistence.schedule()
    notify('session-disposed', { id: safe(() => session?.id) })
  })

  ctx.on('session/event', (session, event) => {
    diag.handlers['session/event'] += 1
    rememberEvent(diag, event)
    checkVocabulary()
    index.record(session, event)
    persistence.schedule()
  })

  ctx.on('agent/created', (payload) => {
    diag.handlers['agent/created'] += 1
    const agentId = payload?.agent?.id ?? payload?.id
    // agent id 与 session id 是否相同是未验证的宿主行为：先解析出 session，
    // 再用它自己的 id 建键/标记，这样两种世界里都成立。
    const session = payload?.agent?.session ?? sessions?.get?.(agentId)
    index.upsert(session)
    index.markRunning(sessionIdOf(session) ?? agentId, true)
    notify('agent-created', { id: agentId })
  })

  ctx.on('agent/disposed', (payload) => {
    diag.handlers['agent/disposed'] += 1
    const agentId = payload?.agent?.id ?? payload?.id
    const session = payload?.agent?.session ?? sessions?.get?.(agentId)
    index.markRunning(sessionIdOf(session) ?? agentId, false)
    notify('agent-disposed', { id: agentId })
  })

  ctx.on('agent/status', (payload) => {
    diag.handlers['agent/status'] += 1
    const agentId = payload?.agent?.id ?? payload?.id
    const session = payload?.agent?.session ?? sessions?.get?.(agentId)
    index.markRunning(sessionIdOf(session) ?? agentId, payload?.status === 'running')
    notify('agent-status', { id: agentId, status: payload?.status })
  })

  // 插件加载时已经在跑的会话也要进索引（插件可能是在会话中途被挂载的）。
  // 注意：safe() 只保护调用本身，因此这里还要确认拿到的确实是数组——
  // 若 list() 返回 Promise，for...of 会在 apply 顶层抛错，整个插件加载失败。
  //
  // 宿主当前就是**异步**实现（返回 Promise），所以两条路都接：数组当场登记，
  // Promise 解析后再登记。用 .then 而不是 await，避免把 apply 变成异步函数。
  // 列表项可能是存活会话（能读历史，走 upsert），也可能只是会话描述（只有 id/标题，
  // 走 seed）——按有没有 deriveMessages 分流。
  const hasList = typeof sessions?.list === 'function'
  const seedListed = (listed) => {
    for (const item of listed) {
      if (typeof item?.deriveMessages === 'function') index.upsert(item)
      else index.seed(item)
    }
  }
  if (!hasList) {
    diag.notes.push('宿主没有 sessions.list()：加载时的会话补登记被跳过。')
  } else {
    safe(() => {
      const listed = sessions?.list?.()
      if (Array.isArray(listed)) {
        seedListed(listed)
        return
      }
      if (listed && typeof listed.then === 'function') {
        listed.then(
          (rows) => {
            if (Array.isArray(rows)) seedListed(rows)
            else diag.notes.push('sessions.list() 的 Promise 解析结果不是数组：加载时的会话补登记被跳过。')
          },
          () => diag.notes.push('sessions.list() 的 Promise 被拒绝：加载时的会话补登记被跳过。'),
        )
        return
      }
      diag.notes.push('sessions.list() 既不是数组也不是 Promise：加载时的会话补登记被跳过。')
    })
  }

  // ── 工具注册 ──────────────────────────────────────────────────────────────
  ctx.effect(() =>
    registerConversationTools(ctx, index, {
      sessions,
      agents,
      diag,
      // 工具改了索引之后要能把快照排进持久化队列，否则标题/派生会话可能永远不落盘。
      schedule: persistence.schedule,
      // 调用时再解析，避免 apply 时快照到一个「稍后才注册」的服务。
      getSessionController: () => safe(() => ctx.get?.('sessionController')),
      // 同样惰性解析：客户端模块表服务（浏览器半的装载名册）。
      // 自检靠它回答「本插件的浏览器半到底进没进 Web 启动图」。
      getClientModules: () => safe(() => ctx.get?.('clientModules')),
      // 磁盘清理（列出/删除/恢复）靠它定位 sessions 与投影缓存。缺失时工具会如实报错。
      dshHome: safe(() => process.env.DSH_HOME) ?? '',
      // 回收站镜像开关：false 时工具不往工作区写镜像文件。
      trashMirror: settings.trashMirror !== false,
    }),
  )
  ctx.effect(() => () => persistence.flush())

  // ── 中文查询的字面兜底 ────────────────────────────────────────────────────
  // 官方索引搜不到中文子串，所以把宿主的搜索入口包一层：查询含 CJK 时额外扫一遍磁盘、
  // 把命中合并进去。官方放大镜与本插件面板走的是同一个入口，因此两处一起受益；
  // 英文查询不触发扫描，错误语义也完全不变（详见 lib/search-cjk.js）。
  //
  // 候选为什么不止一个（0.5.0 的教训）：网关把 `remote.session.search` 绑在
  // **sessionController**（`namespace: "session"`）上，而 `sessions` 是会话存储
  // （同步 `list()`），两者不是同一个对象——0.5.0 只包了后者，补丁从未被调用。
  const cjkEnabled = settings.cjkSearch !== false
  /** 自检账本：`calls` 只记真正读了磁盘的次数，`cacheHits` 记复用上次结果的次数。 */
  const cjkDiag = {
    installed: false,
    reason: cjkEnabled ? 'not-started' : 'disabled',
    targets: {},
    attempts: 0,
    calls: 0,
    cacheHits: 0,
    added: 0,
    lastElapsedMs: null,
  }
  const cjkRestores = []
  let cjkAttempts = 0
  /** sessionController 可能比本插件晚注册：给几次重试机会，装上真正的入口就停。 */
  const CJK_MAX_ATTEMPTS = 10
  const cjkOptions = {
    scan: createCjkScanner({
      budgetMs: settings.cjkSearchBudgetMs,
      maxConversations: settings.cjkSearchMaxConversations,
    }),
    log,
    onScan: (info) => {
      if (info.cached === true) {
        cjkDiag.cacheHits += 1
      } else {
        cjkDiag.calls += 1
        cjkDiag.lastElapsedMs = info.elapsedMs
      }
      cjkDiag.added += info.added
    },
  }
  const cjkCandidates = () => [
    { name: 'sessionController', target: safe(() => ctx.get?.('sessionController')) },
    { name: 'sessions', target: sessions },
  ]
  const ensureCjk = () => {
    if (!cjkEnabled) return
    // 装上真正的入口就停；否则继续尝试（最多 CJK_MAX_ATTEMPTS 次）。
    if (cjkDiag.targets.sessionController === 'installed') return
    if (cjkAttempts >= CJK_MAX_ATTEMPTS) return
    cjkAttempts += 1
    const outcome = installCjkSearchAll(cjkCandidates(), cjkOptions)
    cjkRestores.push(outcome.restore)
    cjkDiag.attempts = cjkAttempts
    cjkDiag.installed = outcome.installed || cjkDiag.installed
    cjkDiag.reason = outcome.reason
    cjkDiag.targets = outcome.targets
    if (outcome.targets.sessionController === 'installed') {
      log.info(`中文搜索兜底已挂在 sessionController.search 上（第 ${cjkAttempts} 次尝试）`)
    }
    // 装配结果变了就落一次盘：这是外部能读到的验收凭证。
    writeHostStatus()
  }
  ensureCjk()
  // 重试钩子：sessionController 若晚于本插件注册，第一个会话事件到达时补装。
  // 顺带保证状态快照至少落盘一次 —— 万一 apply 时还没拿到任何存活会话。
  ctx.on('session/event', (session) => {
    ensureCjk()
    if (!statusWritten) writeHostStatus([safe(() => session?.header?.cwd)])
  })
  // 注册即可逆效果：插件卸载时把原方法放回去。
  ctx.effect(() => () => {
    for (const restore of cjkRestores) restore()
  })

  // ── 对外服务 ──────────────────────────────────────────────────────────────
  const service = {
    /** 列出对话（最近活动在前）。 */
    list: (options) => index.list(options),
    /** 取一条对话的元数据（按 id 精确匹配，与 conversation_get 语义一致）。 */
    get: (id) => {
      const record = index.get(id)
      return record ? view(record) : undefined
    },
    /** 关键字检索。 */
    search: (query, options) => index.search(query, options),
    /** 汇总统计。 */
    stats: () => index.stats(),
    /** 设置管理器侧标题。 */
    label: (id, title) => {
      const record = index.get(id)
      if (!record) return false
      record.title = String(title ?? '')
      persistence.schedule()
      notify('relabeled', { id })
      return true
    },
    /** 某个对话此刻是否有存活会话（决定能否读到完整历史）。 */
    isLive: (id) => index.sessions.has(id),
    /** 自检账本：宿主服务的真实形态与已观测到的事件类型。 */
    diagnostics: () => diagnostics(),
  }
  diag.providedVia = provideService(ctx, 'conversationManager', service, log)

  /** 把自检账本整理成可 JSON 序列化的快照（Set 不能直接序列化）。 */
  function diagnostics() {
    return {
      startedAt: new Date(diag.startedAt).toISOString(),
      providedVia: diag.providedVia,
      injected: { ...diag.injected },
      handlersFired: { ...diag.handlers },
      distinctEventTypes: [...diag.eventTypes].sort(),
      coreTypesSeen: diag.coreTypesSeen,
      extensionEventTypes: [...diag.extensionTypes].sort(),
      sampleEvents: diag.sampleEvents,
      notes: [...diag.notes],
      /** 中文兜底的安装与使用情况（只有计数，不记录用户搜了什么）。 */
      cjkSearch: { ...cjkDiag },
      deepScan: index.deepScan,
      readerSources: [...new Set([...index.records.values()].map((row) => row.readerSource).filter(Boolean))],
      tracked: index.records.size,
      liveSessions: index.sessions.size,
    }
  }

  /**
   * 判断「核心事件词表是否对得上」。
   *
   * 关键点：`SessionEventMap` 是可合并扩展的，运行时必然出现大量合法扩展事件
   * （`command/run`、`session/title`、`approval/*`、`tool/ptc-dispatch` …）。
   * 所以**不能**用「有没有陌生类型」当判据——那只会对正常事件刷警告。
   * 真正的危险信号是「看了不少事件，却一条核心类型都没命中」，那才意味着
   * 历史与计数会静默全为 0。
   */
  function checkVocabulary() {
    if (diag.vocabularyWarned || diag.coreTypesSeen > 0) return
    if (diag.handlers['session/event'] < 5) return
    diag.vocabularyWarned = true
    log.warn(
      `已经收到 ${diag.handlers['session/event']} 条会话事件，但没有一条属于本插件认识的核心类型；` +
        `对话历史与计数可能全为 0。已观测到的类型：${[...diag.eventTypes].sort().join(', ')}`,
    )
  }

  log.info(
    `对话管理器已加载：已追踪 ${index.records.size} 个对话，服务暴露方式 ${diag.providedVia}，` +
      `工具 conversation_list / conversation_get / conversation_history / conversation_search / ` +
      `conversation_stats / conversation_label / conversation_fork / conversation_selftest`,
  )

  /** 广播管理器状态变化；自定义事件没有类型声明，因此用 try/catch 兜底。 */
  function notify(reason, detail) {
    safe(() => ctx.emit?.('conversation-manager/changed', { reason, ...detail }))
  }
}

/**
 * 把服务挂到 ctx 上。
 * 优先 `ctx.provide`（会通知依赖它的插件激活）；退化到 `ctx.set`（低层写入）。
 * 两者都是文档列出的低层服务存储访问方式，因此不需要 import `Service` 基类。
 * 返回实际生效的方式，供自检工具对账。
 */
function provideService(ctx, key, value, log) {
  const provided = safe(() => {
    if (typeof ctx.provide === 'function') {
      ctx.provide(key, value)
      return true
    }
    return false
  })
  if (provided) return 'provide'
  const set = safe(() => {
    if (typeof ctx.set === 'function') {
      ctx.set(key, value)
      return true
    }
    return false
  })
  if (!set) {
    log.warn(`无法暴露 ctx.${key}（宿主上下文没有 provide/set），工具仍然可用`)
    return 'failed'
  }
  return 'set'
}

/**
 * 记录一条已观测事件的可序列化描述（每种类型只留第一份样本）。
 * 同时区分「核心类型」与「扩展类型」——后者是各插件合并进 SessionEventMap 的合法事件。
 */
function rememberEvent(diag, event) {
  const type = safe(() => event?.type)
  if (typeof type !== 'string') return
  diag.eventTypes.add(type)
  if (isCoreEventType(type)) diag.coreTypesSeen += 1
  else diag.extensionTypes.add(type)
  if (diag.sampleEvents[type]) return
  const preview = safe(() => {
    const json = JSON.stringify(event)
    return typeof json === 'string' ? json.slice(0, 600) : undefined
  })
  diag.sampleEvents[type] = {
    eventKeys: Object.keys(event ?? {}),
    dataKeys: Object.keys(safe(() => event.data) ?? {}),
    preview,
  }
}

/**
 * 索引的磁盘快照。默认关闭：只有配置了 persistPath 才会读写文件，避免插件
 * 在用户机器上产生意外写入。
 */
function createPersistence(settings, index, log) {
  const path = typeof settings.persistPath === 'string' ? settings.persistPath.trim() : ''
  let timer = null
  let dirty = false

  const write = () => {
    if (!path || !dirty) return
    const payload = JSON.stringify(index.toJSON(), null, 2)
    const ok = safe(() => {
      const dir = dirname(path)
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, payload, 'utf8')
      return true
    })
    if (ok) {
      // 只有真的写成功才清脏标记：瞬态失败（占用、权限）应当留给下一次重试。
      dirty = false
      return
    }
    log.warn(`写入对话索引失败（保持脏标记，稍后重试）：${path}`)
  }

  return {
    load() {
      if (!path || !existsSync(path)) return
      const snapshot = safe(() => JSON.parse(readFileSync(path, 'utf8')))
      if (!snapshot) {
        log.warn(`对话索引文件无法解析，已忽略：${path}`)
        return
      }
      const restored = index.load(snapshot)
      log.info(`已从 ${path} 恢复 ${restored} 条对话记录（存活状态在新进程里重置）`)
    },
    schedule() {
      if (!path) return
      dirty = true
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        write()
      }, Math.max(50, Number(settings.saveDebounceMs) || DEFAULTS.saveDebounceMs))
      // 不要因为一个待写快照而拖住进程退出。
      safe(() => timer.unref?.())
    },
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      write()
    },
  }
}

/**
 * 读本插件的版本号，写进宿主状态快照。
 * 读不到（打包异常、权限问题）就返回空串，绝不因此让插件加载失败。
 */
function readPluginVersion() {
  try {
    const parsed = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'))
    return typeof parsed?.version === 'string' ? parsed.version : ''
  } catch {
    return ''
  }
}

/** 优先用宿主 logger，缺失时退回 console。 */
function makeLogger(ctx) {
  const logger = safe(() => ctx.logger)
  const wrap = (level, fallback) => (message) => {
    const fn = logger?.[level]
    if (typeof fn === 'function') {
      safe(() => fn.call(logger, message))
      return
    }
    fallback(`[conversation-manager] ${message}`)
  }
  return {
    info: wrap('info', console.log),
    warn: wrap('warn', console.warn),
  }
}
