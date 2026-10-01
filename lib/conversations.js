/**
 * 对话（会话）索引。
 *
 * DSH 的会话日志是「唯一真源」，但 SessionStore 只保留存活会话；为了让
 * 「对话管理器」在一个进程生命周期内始终能列出、检索、统计对话，这里维护
 * 一份轻量派生的索引：只记录元数据与计数，不复制消息正文（正文仍按需从
 * 会话日志读取）。
 */

import {
  accumulateUsage,
  billableInputTokens,
  blockText,
  countEvents,
  countFromMessages,
  deriveHistory,
  logLength,
  readEvents,
  safe,
  sessionCwd,
  toReadableMessage,
  truncate,
} from './events.js'

/** 一条被追踪的对话。 */
function createRecord(id) {
  return {
    id,
    title: '',
    cwd: undefined,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    live: false,
    running: false,
    disposedAt: undefined,
    turns: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    events: 0,
    usage: {},
    /** 历史读取实际走的路径：'deriveMessages'（非弃用）或 'events'（投影退化）。 */
    readerSource: undefined,
  }
}

export class ConversationIndex {
  constructor(options = {}) {
    this.maxTracked = options.maxTracked ?? 500
    this.titleMax = options.titleMax ?? 80
    /**
     * 是否允许使用已弃用的 `session.snapshotEvents()` 做一次全量深扫。
     * 默认关闭：发布代码把该读法标记为「禁止新增生产调用」。开启后可以补出
     * `turns` 计数与更准的创建/活动时间戳（这些信息不在 Message 里）。
     */
    this.deepScan = options.deepScan === true
    this.startedAt = Date.now()
    /** @type {Map<string, ReturnType<typeof createRecord>>} */
    this.records = new Map()
    /** 存活会话的引用，供读取历史使用；会话销毁后移除，但索引记录保留。 */
    this.sessions = new Map()
  }

  /** 登记（或刷新）一个会话。 */
  upsert(session) {
    const id = sessionId(session)
    if (!id) return undefined
    let record = this.records.get(id)
    if (!record) {
      record = createRecord(id)
      this.records.set(id, record)
      this.backfill(record, session)
    } else if (record.restored) {
      // 从磁盘恢复后第一次见到存活会话：补一次全量统计，否则增量计数会永久偏低。
      record.restored = false
      this.backfill(record, session)
    }
    record.live = true
    record.disposedAt = undefined
    const cwd = sessionCwd(session)
    if (cwd) record.cwd = cwd
    this.sessions.set(id, session)
    this.evictIfNeeded()
    return record
  }

  /**
   * 用非弃用读法补齐一条新记录的计数与标题。
   *
   * 依据本机 app.asar 里的实际发布声明：历史用 `deriveMessages()`，长度用 `seq`。
   * 轮次与时间戳只存在于事件日志里，默认**不**为此调用已弃用的 `snapshotEvents()`；
   * 需要它们时由 `deepScan` 显式开启（见 `deepScanExtras`）。
   * backfill 是赋值而非累加，因此重复调用是安全的。
   */
  backfill(record, session) {
    record.events = logLength(session)
    const history = deriveHistory(session)
    record.readerSource = history.source
    const counts = countFromMessages(history.messages)
    record.userMessages = counts.userMessages
    record.assistantMessages = counts.assistantMessages
    record.toolCalls = counts.toolCalls
    const firstUser = history.messages.find((message) => message?.role === 'user')
    if (firstUser) this.adoptTitle(record, firstUser.content ?? firstUser.text)
    if (this.deepScan) this.deepScanExtras(record, session)
  }

  /**
   * 弃用读法（`snapshotEvents()`）的显式深扫：补出轮次数、usage 与时间戳。
   * 只有 `deepScan: true` 时才会被调用——发布代码禁止新增这类生产调用。
   */
  deepScanExtras(record, session) {
    const events = readEvents(session)
    if (!events.length) return
    const counts = countEvents(events)
    record.turns = counts.byType['turn/start'] ?? 0
    for (const event of events) {
      if (event?.type === 'assistant/message') accumulateUsage(record.usage, event?.data?.usage)
    }
    const firstTime = events.find((event) => typeof event?.time === 'number')?.time
    if (typeof firstTime === 'number') record.createdAt = firstTime
    const lastTime = [...events].reverse().find((event) => typeof event?.time === 'number')?.time
    if (typeof lastTime === 'number') record.lastActivity = lastTime
  }

  /** 按日志增量更新一条记录。 */
  record(session, event) {
    const id = sessionId(session)
    if (!id) return undefined
    const existing = this.records.get(id)
    if (!existing) {
      // 首次见到这个会话：backfill 会通读日志，本条事件已经被算进去了。
      const created = this.upsert(session)
      if (created && typeof event?.time === 'number') created.lastActivity = event.time
      return created
    }
    existing.events += 1
    if (typeof event?.time === 'number') existing.lastActivity = event.time
    switch (event?.type) {
      case 'turn/start':
        existing.turns += 1
        break
      case 'user/message':
        existing.userMessages += 1
        if (!existing.title) this.adoptTitle(existing, event.data?.content)
        break
      case 'assistant/message':
        existing.assistantMessages += 1
        accumulateUsage(existing.usage, event.data?.usage)
        break
      case 'tool/call':
        existing.toolCalls += 1
        break
      default:
        break
    }
    return existing
  }

  /** 把第一条用户消息的前若干字符当作标题。 */
  adoptTitle(record, content) {
    const text = truncate(blockText(content), this.titleMax).replace(/\s+/g, ' ').trim()
    if (text) record.title = text
  }

  /** 标记某个会话的 agent 是否在跑（agent/status、agent/created 等事件驱动）。 */
  markRunning(id, running) {
    if (!id) return
    const record = this.records.get(id)
    if (!record) return
    record.running = running === true
    if (record.running) record.lastActivity = Date.now()
  }

  /** 会话离开内存 store：保留索引记录，只断开引用。 */
  markDisposed(session) {
    const id = sessionId(session)
    if (!id) return
    this.sessions.delete(id)
    const record = this.records.get(id)
    if (!record) return
    record.live = false
    record.running = false
    record.disposedAt = Date.now()
  }

  /** 取一条记录。 */
  get(id) {
    return this.records.get(id)
  }

  /** 取存活会话引用。 */
  getSession(id) {
    return this.sessions.get(id)
  }

  /** 列出对话，按最近活动倒序。 */
  list(options = {}) {
    const { limit = 20, query, includeCold = true } = options
    let rows = [...this.records.values()]
    if (!includeCold) rows = rows.filter((row) => row.live)
    if (query) {
      const needle = String(query).toLowerCase()
      rows = rows.filter((row) => matches(row, needle))
    }
    rows.sort((a, b) => b.lastActivity - a.lastActivity)
    return rows.slice(0, Math.max(0, limit)).map(view)
  }

  /** 在标题、工作目录与存活会话的消息正文里检索。 */
  search(query, options = {}) {
    const { limit = 10, scanLive = true } = options
    const needle = String(query ?? '').toLowerCase()
    if (!needle) return []
    const hits = []
    for (const record of this.records.values()) {
      const localMatched = matches(record, needle)
      const snippets = []
      if (scanLive) {
        const session = this.sessions.get(record.id)
        if (session) {
          // 走非弃用的 deriveMessages()；来自消息正文的命中给一小段上下文。
          for (const raw of deriveHistory(session).messages) {
            const entry = toReadableMessage(raw)
            const text = typeof entry?.text === 'string' ? entry.text : ''
            if (text && text.toLowerCase().includes(needle)) {
              snippets.push({ role: entry.role, seq: entry.seq, excerpt: excerpt(text, needle) })
              if (snippets.length >= 3) break
            }
          }
        }
      }
      if (!localMatched && snippets.length === 0) continue
      hits.push({ record, snippets })
    }
    // 先按原始记录的毫秒时间戳排序，再投影成对外视图（视图里的时间是 ISO 字符串）。
    hits.sort((a, b) => b.record.lastActivity - a.record.lastActivity)
    return hits.slice(0, Math.max(0, limit)).map((hit) => ({ ...view(hit.record), matches: hit.snippets }))
  }

  /** 汇总统计。 */
  stats() {
    const rows = [...this.records.values()]
    const usage = {}
    let turns = 0
    let userMessages = 0
    let assistantMessages = 0
    let toolCalls = 0
    let events = 0
    for (const row of rows) {
      turns += row.turns
      userMessages += row.userMessages
      assistantMessages += row.assistantMessages
      toolCalls += row.toolCalls
      events += row.events
      accumulateUsage(usage, row.usage)
    }
    return {
      conversations: rows.length,
      live: rows.filter((row) => row.live).length,
      running: rows.filter((row) => row.running).length,
      turns,
      userMessages,
      assistantMessages,
      toolCalls,
      events,
      usage,
      // 按文档口径单独给出「计费输入」：usage 里的字段互不重叠，
      // 而 reasoningTokens 已含在 outputTokens 中，所以不要把 usage 的字段相加。
      billableInputTokens: billableInputTokens(usage),
      countersSince: this.startedAt ?? null,
    }
  }

  /** 超出上限时淘汰最久未活动且不存活的记录。 */
  evictIfNeeded() {
    if (this.records.size <= this.maxTracked) return
    const candidates = [...this.records.values()]
      .filter((row) => !row.live)
      .sort((a, b) => a.lastActivity - b.lastActivity)
    for (const row of candidates) {
      if (this.records.size <= this.maxTracked) break
      this.records.delete(row.id)
    }
  }

  /** 持久化用的纯数据快照。 */
  toJSON() {
    return { version: 1, savedAt: Date.now(), records: [...this.records.values()] }
  }

  /**
   * 从快照恢复（只恢复元数据；live/running 在新进程里一律重置为 false）。
   * 恢复的记录打上 `restored` 标记，等它对应的存活会话再次出现时补一次全量统计。
   * @returns 本次真正恢复的记录条数
   */
  load(snapshot) {
    const rows = Array.isArray(snapshot?.records) ? snapshot.records : []
    let restored = 0
    for (const row of rows) {
      if (!row || typeof row.id !== 'string') continue
      const record = { ...createRecord(row.id), ...row, live: false, running: false, restored: true }
      this.records.set(record.id, record)
      restored += 1
    }
    return restored
  }
}

/** 取出会话 id。 */
export function sessionId(session) {
  const id = safe(() => session?.id)
  if (typeof id === 'string') return id
  return undefined
}

/** 记录是否能被关键字命中。 */
function matches(record, needle) {
  return (
    record.id.toLowerCase().includes(needle) ||
    (record.title ?? '').toLowerCase().includes(needle) ||
    (record.cwd ?? '').toLowerCase().includes(needle)
  )
}

/** 截取关键字周围的一小段上下文。 */
function excerpt(text, needle) {
  const at = text.toLowerCase().indexOf(needle)
  const start = Math.max(0, at - 60)
  const end = Math.min(text.length, at + needle.length + 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`
}

/** 一条记录的外部视图（供服务与工具复用，保证两种入口返回同一形状）。 */
export function view(record) {
  return {
    id: record.id,
    title: record.title || '(untitled)',
    cwd: record.cwd,
    live: record.live,
    running: record.running,
    createdAt: iso(record.createdAt),
    lastActivity: iso(record.lastActivity),
    turns: record.turns,
    userMessages: record.userMessages,
    assistantMessages: record.assistantMessages,
    toolCalls: record.toolCalls,
    usage: record.usage,
  }
}

/** 毫秒时间戳 → ISO 字符串。 */
function iso(ms) {
  return typeof ms === 'number' ? new Date(ms).toISOString() : null
}
