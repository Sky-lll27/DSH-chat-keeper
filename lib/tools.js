/**
 * 对话管理器对模型暴露的工具。
 *
 * 这里手写 ToolDefinition，而不是用 `@deepseek-ai/dsh-tools` 的 `defineTool`：
 * 插件放在 harness 源码树之外（例如通过 `--patch` 用绝对路径挂载）时，Node 的
 * 裸模块解析走不到 `@deepseek-ai/*`，任何顶层 import 都会让插件加载失败。
 * ToolDefinition 本身就是「ToolSchema + output + execute」的契约，注册表接受
 * 手写定义；代价是参数校验要由自己负责，下面的 coerce* 做的就是这件事。
 *
 * 参数与输出都使用 DSH 强制的 JSON Schema 子集。
 */

import { join } from 'node:path'

import {
  blockText,
  countFromMessages,
  deriveHistory,
  logLength,
  messageToolCalls,
  projectMessages,
  readEventsAsync,
  safe,
  toReadableMessage,
} from './events.js'
import { SESSION_LOG_NAME, listConversations, listTrashBatches, moveToTrash, purgeTrash, resolveDshHome, restoreBatch } from './cleanup.js'
import { refreshTrashMirrors } from './trash-mirror.js'
import { readEventsFromFile } from './log-read.js'
import { searchConversationsOnDisk } from './search-disk.js'

/** 结构化结果统一渲染成带缩进的 JSON 文本。 */
function renderJson(_args, value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/** 对象根输出声明。 */
const OBJECT_OUTPUT = { schema: { type: 'object', additionalProperties: true }, render: renderJson }

/** 数组根输出声明。 */
const ARRAY_OUTPUT = {
  schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
  render: renderJson,
}

/** 由属性表构造隐式开放对象根之外的显式参数 schema。 */
function params(properties, required) {
  const schema = { type: 'object', properties, additionalProperties: false }
  if (Array.isArray(required) && required.length) schema.required = required
  return schema
}

/** 通用卡片：pending 状态的展示意图。 */
function card(title, kind = 'other') {
  return { card: 'generic', title, kind }
}

/** 把值收成字符串。 */
function coerceString(value, fallback = undefined) {
  if (typeof value === 'string' && value.length) return value
  if (typeof value === 'number') return String(value)
  return fallback
}

/** 把值收成受限整数。 */
function coerceInt(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** 把值收成布尔。 */
function coerceBool(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

/**
 * 注册全部对话管理工具。
 * @param {object} ctx 插件上下文
 * @param {import('./conversations.js').ConversationIndex} index 对话索引
 * @param {object} deps 依赖注入（sessions 服务等）
 */
export function registerConversationTools(ctx, index, deps = {}) {
  const definitions = [
    listTool(index),
    getTool(index),
    historyTool(index, deps),
    searchTool(index, deps),
    statsTool(index),
    labelTool(index, deps),
    forkTool(index, deps),
    selftestTool(index, deps),
    listAllTool(index, deps),
    deleteTool(index, deps),
    restoreTool(index, deps),
    purgeTool(index, deps),
  ]
  const disposers = definitions.map((definition) => ctx.tools.register(definition))
  // 注册完成后再记名字：自检工具在 execute 时读 deps，因此能看到这份清单。
  deps.toolNames = definitions.map((definition) => definition.name)

  return () => {
    for (const dispose of disposers) safe(() => dispose?.())
  }
}

/** 列出对话。 */
function listTool(index) {
  return {
    name: 'conversation_list',
    description:
      'List tracked conversations (sessions) of this DeepSeek Harness instance, most recently active first. ' +
      'Use it to find the id of an earlier conversation before reading its history.',
    parameters: params(
      {
        limit: { type: 'integer', description: 'Maximum rows to return (default 20, max 100).' },
        query: { type: 'string', description: 'Case-insensitive filter over id, title, and workspace path.' },
        include_cold: {
          type: 'boolean',
          description: 'Include conversations whose live session has already been disposed (default true).',
        },
      },
      [],
    ),
    output: OBJECT_OUTPUT,
    presentCall: (args) => card(`List conversations${coerceString(args?.query) ? ` matching "${coerceString(args.query)}"` : ''}`, 'read'),
    async execute(args) {
      const options = {
        limit: coerceInt(args?.limit, 20, 1, 100),
        query: coerceString(args?.query),
        includeCold: coerceBool(args?.include_cold, true),
      }
      const rows = index.list(options)
      return { conversations: rows, returned: rows.length, tracked: index.records.size }
    },
  }
}

/** 读取单个对话的详情。 */
function getTool(index) {
  return {
    name: 'conversation_get',
    description:
      'Show one conversation\'s metadata (title, workspace, counters, token usage) plus its most recent messages. ' +
      'Requires the conversation id from conversation_list.',
    parameters: params(
      {
        conversation_id: { type: 'string', description: 'Conversation (session) id.' },
        recent_messages: { type: 'integer', description: 'How many trailing messages to include (default 8, max 50).' },
        include_tools: { type: 'boolean', description: 'Include tool calls and results in the message window.' },
      },
      ['conversation_id'],
    ),
    output: OBJECT_OUTPUT,
    presentCall: (args) => card(`Inspect conversation ${coerceString(args?.conversation_id) ?? '?'}`, 'read'),
    async execute(args) {
      const id = coerceString(args?.conversation_id)
      if (!id) throw new Error('conversation_id is required')
      const record = index.get(id)
      if (!record) throw new Error(`Unknown conversation: ${id}`)
      const limit = coerceInt(args?.recent_messages, 8, 1, 50)
      const includeTools = coerceBool(args?.include_tools, false)
      const session = index.getSession(id)
      const detail = await readLiveDetail(session, limit, includeTools)
      return { conversation: index.list({ limit: 1, query: id })[0] ?? { id }, ...detail }
    },
  }
}

/** 读取对话历史消息。 */
function historyTool(index, deps) {
  return {
    name: 'conversation_history',
    description:
      'Read the message history of a conversation as user/assistant turns, newest last. Works for live sessions AND for ' +
      'conversations that are not loaded in this process (it falls back to reading the session log from disk). ' +
      'Pass around_seq (from conversation_search) to read the window of messages around one matched event — that is how you ' +
      'show the original text a search hit came from.',
    parameters: params(
      {
        conversation_id: { type: 'string', description: 'Conversation (session) id.' },
        limit: { type: 'integer', description: 'Trailing messages to return (default 30, max 200).' },
        include_tools: { type: 'boolean', description: 'Include tool calls and their results.' },
        with_tool_results: { type: 'boolean', description: 'Include tool results (only meaningful with include_tools).' },
        around_seq: { type: 'integer', description: 'Read around this event seq (from conversation_search) instead of the tail.' },
        window: { type: 'integer', description: 'How many events on each side of around_seq to include (default 30, max 300).' },
        from_disk: { type: 'boolean', description: 'Force reading the log from disk instead of the live session.' },
      },
      ['conversation_id'],
    ),
    output: OBJECT_OUTPUT,
    presentCall: (args) => card(`Read history of ${coerceString(args?.conversation_id) ?? '?'}`, 'read'),
    async execute(args) {
      const id = coerceString(args?.conversation_id)
      if (!id) throw new Error('conversation_id is required')
      const options = {
        limit: coerceInt(args?.limit, 30, 1, 200),
        includeTools: coerceBool(args?.include_tools, false),
        withToolResults: coerceBool(args?.with_tool_results, false),
        window: coerceInt(args?.window, 30, 1, 300),
      }
      const aroundSeq = coerceInt(args?.around_seq, -1, -1, Number.MAX_SAFE_INTEGER)
      const fromDisk = coerceBool(args?.from_disk, false) || aroundSeq >= 0
      const session = fromDisk ? undefined : index.getSession(id)

      if (session !== undefined) {
        const history = await readHistory(session, options)
        return { conversationId: id, available: true, source: 'live', messageCount: history.messages.length, ...history }
      }

      // 磁盘回退：冷对话（未装载的会话）也能读——"看昨天那段话"通常走的正是这条路。
      // 注意：解析不到 DSH_HOME 时也必须给出 `available: false` 这个**统一形状**，
      // 不能只回一个 error 字段——调用方（含测试与模型）是按 available 判断可读性的。
      const home = resolveHome(deps)
      if (home === undefined) {
        return {
          conversationId: id,
          available: false,
          source: 'none',
          reason: homeError(deps),
          messages: [],
        }
      }
      const disk = readHistoryFromDisk(home, id, aroundSeq >= 0 ? { ...options, aroundSeq } : options)
      return { conversationId: id, ...disk }
    },
  }
}

/**
 * 从磁盘读对话历史（冷对话可用）；给了 `aroundSeq` 就只读那条事件附近的窗口。
 */
function readHistoryFromDisk(dshHome, conversationId, options = {}) {
  const { limit = 30, includeTools = false, withToolResults = false, window = 30, aroundSeq } = options
  const row = listConversations(dshHome, new Set()).find(candidate => candidate.id === conversationId)
  if (row === undefined) {
    return { available: false, source: 'disk', reason: 'no conversation directory on disk for this id', messages: [] }
  }
  let events
  let meta
  try {
    meta = readEventsFromFile(join(row.dir, SESSION_LOG_NAME))
    events = meta.events
  } catch (error) {
    return { available: false, source: 'disk', reason: String(error?.message ?? error), messages: [] }
  }

  const around = typeof aroundSeq === 'number' && aroundSeq >= 0 ? aroundSeq : undefined
  const scoped = around === undefined
    ? events
    : events.filter(event => typeof event.seq === 'number' && Math.abs(event.seq - around) <= window)
  const all = projectMessages(scoped, {
    limit: 0,
    includeTools,
    withToolResults,
  })
  // around_seq 模式下取"围绕命中处"的一段（而不是尾部 limit 条），这样上下文两侧都有。
  const messages = around === undefined
    ? (limit > 0 && all.length > limit ? all.slice(all.length - limit) : all)
    : (all.length <= limit ? all : all.slice(Math.max(0, Math.floor(all.length / 2) - Math.floor(limit / 2)), Math.floor(all.length / 2) + Math.ceil(limit / 2)))
  return {
    available: true,
    source: 'disk',
    aroundSeq: around ?? null,
    messageCount: messages.length,
    messages,
    counts: {
      events: events.length,
      returnedEvents: scoped.length,
      frames: meta.frames,
      bytes: meta.bytes,
    },
  }
}

/** 全文检索。 */
/**
 * 搜索对话。
 *
 * 两条来源合并：
 *   1. **索引**（快）：本插件对存活会话的正文做了内存索引，元数据（标题/工作目录）也在这里；
 *   2. **磁盘**（全）：直接读会话日志，因此**冷对话也能搜**，而且是**字面子串**匹配——
 *      这一点很关键：DSH 自带的内容索引用 FTS5 `unicode61` 分词器，把一整串连续中文当一个词元，
 *      所以中文子串搜不到（实测：「内容检索示例」整段命中，「检索」0 命中）。
 *
 * 结果按命中次数排序，并如实报告扫描规模与是否因为时间预算提前结束。
 */
function searchTool(index, deps) {
  return {
    name: 'conversation_search',
    description:
      'Search conversations for a literal phrase (case-insensitive) across titles, workspace paths, and the message text of ' +
      'EVERY conversation on disk — including conversations that are not loaded in this process. Matching is literal substring ' +
      'matching, so it works for Chinese substrings (where the built-in FTS tokenizer would fail). ' +
      'Returns matching conversations with a short excerpt, the match count, and a note when the scan stopped early on its time budget.',
    parameters: params(
      {
        query: { type: 'string', description: 'Literal phrase to look for (case-insensitive). Chinese substrings work.' },
        limit: { type: 'integer', description: 'Maximum conversations to return (default 10, max 50).' },
        scan_disk: { type: 'boolean', description: 'Read session logs from disk so cold conversations are searched too (default true).' },
        max_conversations: { type: 'integer', description: 'Cap on how many conversations the disk scan reads, newest first (default 60, max 500).' },
        budget_ms: { type: 'integer', description: 'Time budget for the disk scan in milliseconds (default 5000, max 30000).' },
        include_context: { type: 'boolean', description: 'Also return the messages surrounding each hit (up to 3 hits) so the caller can show the original text.' },
        context_window: { type: 'integer', description: 'Events on each side of a hit when include_context is on (default 8, max 100).' },
      },
      ['query'],
    ),
    output: OBJECT_OUTPUT,
    presentCall: (args) => card(`Search conversations for "${coerceString(args?.query) ?? ''}"`, 'search'),
    async execute(args) {
      const query = coerceString(args?.query)
      if (!query) throw new Error('query is required')
      const limit = coerceInt(args?.limit, 10, 1, 50)
      const scanDisk = coerceBool(args?.scan_disk, true)
      const maxConversations = coerceInt(args?.max_conversations, 60, 1, 500)
      const budgetMs = coerceInt(args?.budget_ms, 5000, 100, 30000)

      // 快路径：内存索引（存活会话的正文 + 全部已登记记录的标题/路径）。
      // 索引给的是 matches **数组**（旧形状），这里统一归一成"命中次数"这个数字，
      // 免得两条来源合并时拿数组去排序、去比较。
      const indexHits = index.search(query, { limit, scanLive: true })
      const merged = new Map()
      for (const hit of indexHits) {
        const id = String(hit?.id ?? '')
        if (id === '') continue
        const raw = hit?.matches
        const matches = typeof raw === 'number' ? raw : Array.isArray(raw) ? raw.length : null
        merged.set(id, { ...hit, matches, source: 'index' })
      }

      let disk
      if (scanDisk) {
        const home = resolveHome(deps)
        if (home !== undefined) {
          disk = searchConversationsOnDisk(home, query, {
            liveIds: liveSessionIds(index),
            maxConversations,
            budgetMs,
            limit,
          })
          for (const hit of disk.hits) {
            const existing = merged.get(hit.id)
            // 两条来源都有时：磁盘命中数更可信（它能读冷对话的完整正文），片段也优先用它。
            merged.set(hit.id, { ...(existing ?? {}), ...hit, source: existing === undefined ? 'disk' : 'both' })
          }
        }
      }

      const hits = [...merged.values()]
        .sort((a, b) => (b.matches ?? 0) - (a.matches ?? 0))
        .slice(0, limit)

      // "原文对照"：把命中处前后的消息一起带回来。
      // 为什么需要它：DSH 没有事件深链接——界面里点搜索结果只能打开会话，到不了那句话；
      // 而读日志时我们知道命中在第几号事件，所以能把那一段原文直接取出来给用户看。
      let contextAttached = 0
      const includeContext = coerceBool(args?.include_context, false)
      if (includeContext) {
        const home = resolveHome(deps)
        const window = coerceInt(args?.context_window, 8, 1, 100)
        for (const hit of hits) {
          if (contextAttached >= 3 || home === undefined) break
          if (typeof hit.seq !== 'number') continue
          const around = readHistoryFromDisk(home, hit.id, {
            aroundSeq: hit.seq,
            window,
            limit: window * 2 + 1,
            includeTools: true,
            withToolResults: false,
          })
          if (around.available !== true) continue
          hit.context = around.messages
          contextAttached += 1
        }
      }

      return {
        query,
        hits,
        returned: hits.length,
        diagnostics: {
          indexHits: indexHits.length,
          diskScanned: disk?.scanned ?? null,
          diskUnreadable: disk?.unreadable ?? null,
          diskTimedOut: disk?.timedOut ?? null,
          diskElapsedMs: disk?.elapsedMs ?? null,
          contextAttached: includeContext ? contextAttached : null,
          /** 说明为什么需要磁盘这一路：自带索引的分词器搜不到中文子串。 */
          note: scanDisk
            ? 'Disk scan covers cold conversations and matches literal substrings (including Chinese), which the built-in FTS tokenizer cannot do.'
            : 'Disk scan disabled: only the in-memory index (live sessions) was searched.',
        },
      }
    },
  }
}

/** 汇总统计。 */
function statsTool(index) {
  return {
    name: 'conversation_stats',
    description:
      'Aggregate counters across all tracked conversations: conversation count, live/running counts, turns, ' +
      'user/assistant messages, tool calls, total events, and token usage as reported by the model adapters.',
    parameters: params({}, []),
    output: OBJECT_OUTPUT,
    presentCall: () => card('Conversation statistics', 'read'),
    async execute() {
      return index.stats()
    },
  }
}

/** 给对话打标签（管理器侧标题）。 */
function labelTool(index, deps) {
  return {
    name: 'conversation_label',
    description:
      'Set the display title of a conversation in this manager\'s index. ' +
      'When the host exposes a durable session-rename service the title is also written to the session itself; ' +
      'the result reports which of the two happened.',
    parameters: params(
      { conversation_id: { type: 'string', description: 'Conversation (session) id.' }, title: { type: 'string', description: 'New display title.' } },
      ['conversation_id', 'title'],
    ),
    output: OBJECT_OUTPUT,
    presentCall: (args) => card(`Label ${coerceString(args?.conversation_id) ?? '?'}`, 'edit'),
    async execute(args) {
      const id = coerceString(args?.conversation_id)
      const title = coerceString(args?.title)
      if (!id) throw new Error('conversation_id is required')
      if (!title) throw new Error('title is required')
      const record = index.get(id)
      if (!record) throw new Error(`Unknown conversation: ${id}`)
      record.title = title
      deps.schedule?.()

      const outcome = await tryDurableRename(resolveSessionController(deps), id, title)
      return { conversationId: id, title, managerTitleUpdated: true, ...outcome }
    },
  }
}

/** 从某个对话派生一个新对话。 */
function forkTool(index, deps) {
  return {
    name: 'conversation_fork',
    description:
      'Fork a conversation into a new session through the session store. ' +
      'An optional boundary is an inclusive source event sequence; omitted forks through the latest event. ' +
      'Only conversations with a live session in this process can be forked.',
    parameters: params(
      {
        conversation_id: { type: 'string', description: 'Source conversation (session) id.' },
        boundary: { type: 'integer', description: 'Inclusive source event seq to fork through.' },
      },
      ['conversation_id'],
    ),
    output: OBJECT_OUTPUT,
    presentCall: (args) => card(`Fork ${coerceString(args?.conversation_id) ?? '?'}`, 'other'),
    async execute(args) {
      const id = coerceString(args?.conversation_id)
      if (!id) throw new Error('conversation_id is required')
      const session = index.getSession(id)
      if (!session) throw new Error(`No live session for conversation: ${id}`)
      const sessions = deps.sessions
      if (!sessions || typeof sessions.fork !== 'function') throw new Error('session store does not expose fork()')
      const boundary = args?.boundary === undefined || args?.boundary === null ? undefined : coerceInt(args.boundary, undefined, 0, Number.MAX_SAFE_INTEGER)
      const child = await sessions.fork(session, boundary)
      const childId = safe(() => (typeof child?.id === 'string' ? child.id : undefined))
      if (child) index.upsert(child)
      deps.schedule?.()
      return { sourceConversationId: id, boundary: boundary ?? null, forkedConversationId: childId ?? null, forked: Boolean(childId) }
    },
  }
}

/**
 * 把一份会话历史统一成对外可读形状。
 *
 * 优先走**非弃用**的 `session.deriveMessages()`；只有当它不存在时才退化到
 * 在事件日志上自行投影（那条路会用到已弃用的 `snapshotEvents()`）。
 *
 * 两种来源的输出形状不同（真正的 `Message` vs 投影条目），这里统一成
 * `{ role, text, ... }`，并把 assistant 消息里的 `tool-call` 块展开成 `toolCalls`。
 */
async function readHistory(session, options = {}) {
  const { limit = 30, includeTools = false, withToolResults = false } = options
  const history = deriveHistory(session)
  const rows = []
  for (const message of history.messages) {
    const entry = toReadableMessage(message)
    if (!entry) continue
    const role = entry.role
    if (role === 'tool') {
      // deriveMessages 产出的工具结果消息
      if (includeTools && withToolResults) rows.push(entry)
      continue
    }
    if (role === 'tool-call' || role === 'tool-result') {
      // 退化投影产出的条目
      if (role === 'tool-call' ? includeTools : includeTools && withToolResults) rows.push(entry)
      continue
    }
    if (includeTools) {
      const calls = messageToolCalls(message)
      if (calls.length) entry.toolCalls = calls
    }
    rows.push(entry)
  }
  const messages = limit > 0 && rows.length > limit ? rows.slice(rows.length - limit) : rows
  // 计数也走非弃用来源：条数用 deriveMessages()，日志长度用 session.seq。
  const counts = { events: logLength(session), ...countFromMessages(history.messages) }
  return {
    messages,
    counts,
    historySource: history.source,
    historyProjected: history.projected,
    deprecatedReaderUsed: history.projected,
  }
}

/** 读取存活会话的历史窗口与计数；没有存活会话时返回说明。 */
async function readLiveDetail(session, limit, includeTools) {
  if (!session) {
    return { available: false, reason: 'no live session for this conversation in the current process', messages: [], counts: null }
  }
  const history = await readHistory(session, { limit, includeTools, withToolResults: includeTools })
  const messages = history.messages.map((message) => ({
    ...message,
    text: typeof message.text === 'string' ? message.text.slice(0, 2000) : blockText(message.text),
  }))
  return {
    available: true,
    counts: history.counts,
    messages,
    historySource: history.historySource,
    deprecatedReaderUsed: history.deprecatedReaderUsed,
  }
}

/**
 * 解析可选的宿主改名服务。
 * 优先用 deps 提供的惰性解析器（调用时再取，避免 apply 时的快照过期），
 * 退化到 deps 上直接给出的实例。
 */
function resolveSessionController(deps) {
  const lazy = safe(() => deps.getSessionController?.())
  if (lazy) return lazy
  return deps.sessionController
}

/** 尝试调用宿主提供的持久化改名服务；任何失败都降级为「仅管理器标题」。 */
async function tryDurableRename(controller, sessionId, title) {
  if (!controller || typeof controller.rename !== 'function') {
    return { durable: false, durableReason: 'host exposes no session rename service' }
  }
  try {
    await controller.rename({ sessionId, title })
    return { durable: true }
  } catch (error) {
    return { durable: false, durableReason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 自检工具。
 *
 * 本插件是在无法执行命令的环境里写的，因此这个工具的作用是：挂载之后用**一次调用**
 * 把「我对宿主的所有假设」和「宿主的真实形态」摆在一起对账，逐条给出结论。
 * 它只读不写，不做任何修改。
 */
/** 本插件的浏览器半在客户端模块表里的包名（= package.json 的 name）。 */
const CLIENT_PACKAGE_ID = 'dsh-conversation-manager'

/**
 * 探测客户端模块表：本插件的浏览器半是否真的进了 Web 启动图。
 *
 * 依据本机 app.asar 里 `dsh-client-modules` 的实际实现：宿主半提供
 * `clientModules` 服务，`graph()` 返回 `{ rev, entries, batches }`，其中 `entries`
 * 就是会被注入成 `window.__DSH_BOOT__` 的名册。扫描器对解析失败的 Loader 行**静默跳过**
 * （只记一条 warning），所以「GUI 里看不到页签」这件事必须靠这里来定位。
 */
function probeClientModules(service) {
  if (!service || typeof service.graph !== 'function') {
    return {
      available: false,
      note: 'ctx.clientModules 不可用：该组合没有挂载 dsh-client-modules（宿主半不受影响）。',
    }
  }
  const graph = safe(() => service.graph()) ?? {}
  const entries = Array.isArray(graph.entries) ? graph.entries : []
  const rows = entries.map((entry) => ({
    id: typeof entry?.id === 'string' ? entry.id : null,
    rev: typeof entry?.rev === 'string' ? entry.rev : null,
    inject: Array.isArray(entry?.inject) ? entry.inject : [],
    external: Array.isArray(entry?.external) ? entry.external : [],
  }))
  const mine = rows.filter((row) => row.id === CLIENT_PACKAGE_ID)
  return {
    available: true,
    graphRev: typeof graph.rev === 'string' ? graph.rev : null,
    entryCount: rows.length,
    packagePresent: mine.length > 0,
    packageRows: mine,
  }
}

function selftestTool(index, deps) {
  return {
    name: 'conversation_selftest',
    description:
      'Diagnose the conversation manager against the live host: check which services exist, how the manager ' +
      'service was exposed, which session events have actually been observed, and whether session history is ' +
      'readable. Read-only. Run it when conversation_* tools behave unexpectedly.',
    parameters: params({}, []),
    output: OBJECT_OUTPUT,
    presentCall: () => card('Conversation manager self-test', 'read'),
    async execute() {
      const diag = deps.diag
      const sessions = deps.sessions
      const controller = resolveSessionController(deps)

      const liveSessions = []
      for (const [id, session] of index.sessions) {
        liveSessions.push(await probeSession(id, session))
      }

      const observedTypes = diag ? [...diag.eventTypes].sort() : []
      const extensionTypes = diag ? [...diag.extensionTypes].sort() : []

      const report = {
        plugin: { name: 'conversation-manager', registeredTools: deps.toolNames ?? null },
        services: {
          injected: diag?.injected ?? null,
          managerExposedVia: diag?.providedVia ?? 'unknown',
          sessionsList: typeof sessions?.list,
          sessionsGet: typeof sessions?.get,
          sessionsFork: typeof sessions?.fork,
          agentsList: typeof deps.agents?.list,
          sessionControllerMethods: controller ? listMethods(controller) : [],
        },
        readers: {
          deepScan: deps.diag?.deepScan ?? null,
          historySourcePerRecord: deps.diag?.readerSources ?? [],
        },
        tracking: {
          handlersFired: diag?.handlers ?? null,
          distinctEventTypes: observedTypes,
          coreTypesSeen: diag?.coreTypesSeen ?? 0,
          extensionEventTypes: extensionTypes,
          sampleEvents: diag?.sampleEvents ?? {},
          notes: diag?.notes ?? [],
          trackedConversations: index.records.size,
          liveSessions: index.sessions.size,
        },
        liveSessionSamples: liveSessions.slice(0, 5),
        clientModules: probeClientModules(safe(() => deps.getClientModules?.())),
        findings: [],
      }

      const findings = report.findings
      if (!diag) {
        findings.push('没有自检账本（插件不是通过正常入口加载的？），下面的结论不完整。')
      }
      // 浏览器半的装载结论（只有坏消息才进 findings，好消息看 report.clientModules）。
      if (report.clientModules?.available === false) {
        findings.push('本组合未挂载 dsh-client-modules：浏览器半没有装载渠道（宿主半与工具不受影响）。')
      } else if (report.clientModules?.packagePresent === false) {
        findings.push(
          `客户端模块表里没有 ${CLIENT_PACKAGE_ID}：GUI 不会出现「对话管理器」页签。`
          + '扫描器对解析失败的 Loader 行只记一条 warning 就跳过，'
          + '请检查该包的 package.json 里 dsh.client 声明与 exports["./client"] 是否可解析。',
        )
      }
      if (!report.services.injected?.tools) {
        findings.push('ctx.tools 不存在：工具没有注册成功。')
      }
      if (report.services.managerExposedVia === 'failed') {
        findings.push('ctx.provide 与 ctx.set 都不可用：其它插件无法消费 conversationManager 服务（工具仍可用）。')
      } else if (report.services.managerExposedVia === 'set') {
        findings.push('服务是通过 ctx.set 暴露的：能读，但不会触发依赖方激活；建议核对 ctx.provide 的签名。')
      }
      if (report.services.sessionsFork !== 'function') {
        findings.push('ctx.sessions.fork 不是函数：conversation_fork 会报「session store does not expose fork()」。')
      }
      if (!controller) {
        findings.push('未发现 sessionController：conversation_label 只更新管理器侧标题，结果里会标注 durable:false。')
      }
      if ((diag?.handlers['session/event'] ?? 0) === 0) {
        findings.push('尚未观测到 session/event：要么本进程还没产生会话事件，要么事件名与本插件假设的不一致（后者会让历史与计数停在初始值）。')
      }
      if ((diag?.coreTypesSeen ?? 0) === 0 && (diag?.handlers['session/event'] ?? 0) > 0) {
        findings.push(
          `已收到 ${diag.handlers['session/event']} 条会话事件，但一条核心类型都没命中：` +
            `投影与计数会全为 0。已观测到的类型：${observedTypes.join(', ') || '(无)'}`,
        )
      }
      if (extensionTypes.length) {
        findings.push(
          `观测到 ${extensionTypes.length} 个扩展事件类型（各插件合并进 SessionEventMap 的合法事件，例如 ${extensionTypes
            .slice(0, 5)
            .join(', ')}）：不影响运行，只是本插件的投影不处理它们。`,
        )
      }
      for (const note of diag?.notes ?? []) findings.push(`加载期提示：${note}`)
      for (const probe of liveSessions) {
        if (!probe.hasDeriveMessages) {
          findings.push(
            `会话 ${probe.id} 上没有 deriveMessages()：历史读取退化到事件投影（会用到已弃用的 snapshotEvents()）。`,
          )
        }
        if (!probe.hasSnapshotEvents) {
          findings.push(`会话 ${probe.id} 上没有 snapshotEvents()：退化路径不可用，历史只能为空。`)
        } else if (probe.snapshotReturns === 'promise') {
          findings.push(
            `会话 ${probe.id} 的 snapshotEvents() 返回 Promise：同步退化路径读不到（默认不走它，` +
              `除非开启 deepScan），异步工具路径不受影响。`,
          )
        } else if (!probe.hasDeriveMessages && probe.snapshotReturns !== 'array') {
          findings.push(`会话 ${probe.id} 的 snapshotEvents() 返回 ${probe.snapshotReturns}，既不是数组也不是 Promise：请核对读取方式。`)
        }
      }
      if (!findings.length) {
        findings.push(
          '所有已检查的假设都成立：服务齐全、核心事件词表命中、存活会话可用非弃用读法读到历史。',
        )
      }
      return report
    },
  }
}

/** 探测一个存活会话的可读性，只读不改。 */
async function probeSession(id, session) {
  const hasDeriveMessages = typeof safe(() => session.deriveMessages) === 'function'
  const snapshotFunction = safe(() => session.snapshotEvents)
  const hasSnapshotEvents = typeof snapshotFunction === 'function'
  let snapshotReturns = 'absent'
  if (hasSnapshotEvents) {
    const raw = safe(() => session.snapshotEvents())
    if (Array.isArray(raw)) snapshotReturns = 'array'
    else if (raw && typeof raw.then === 'function') snapshotReturns = 'promise'
    else snapshotReturns = typeof raw
  }
  const events = await readEventsAsync(session)
  const first = events[0]
  return {
    id,
    hasDeriveMessages,
    hasSnapshotEvents,
    snapshotReturns,
    logLength: safe(() => session.seq) ?? null,
    eventCount: events.length,
    firstEventType: first?.type ?? null,
    firstEventKeys: first ? Object.keys(first) : [],
    firstEventDataKeys: first?.data ? Object.keys(first.data) : [],
    headerKeys: Object.keys(safe(() => session.header) ?? {}),
    cwd: safe(() => session.header?.cwd) ?? null,
  }
}

/** 列出一个服务对象上的方法名（用于报告服务形态，不调用它们）。 */
function listMethods(target) {
  const names = new Set()
  let current = target
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== 'constructor' && typeof safe(() => target[name]) === 'function') names.add(name)
    }
    current = Object.getPrototypeOf(current)
  }
  return [...names].sort()
}

/* ── 磁盘层面的列出 / 删除 / 恢复 ────────────────────────────────────────────
 * DSH 的产品界面只做归档，没有删除。对话在磁盘上是一个目录加一条投影缓存，
 * 所以这里用文件操作补上「删除」，并且默认走回收站（可恢复）。
 * 与内存索引无关：重启后本进程只认识存活会话，而磁盘清单始终完整。
 */

/** 解析 `$DSH_HOME`：候选顺序 + 存在性校验（应用主进程里没有这个环境变量）。 */
function resolveHome(deps) {
  return resolveDshHome(typeof deps.dshHome === 'string' ? deps.dshHome : undefined).home
}

/** 解析失败时给一条能定位问题的报错：列出试过的候选目录。 */
function homeError(deps) {
  const { tried } = resolveDshHome(typeof deps.dshHome === 'string' ? deps.dshHome : undefined)
  return `cannot resolve $DSH_HOME; tried: ${tried.length === 0 ? '(no candidates)' : tried.join(' | ')}`
}

/** 当前进程里存活（正在运行/已装载）的会话 id 集合。 */
function liveSessionIds(index) {
  const ids = new Set()
  for (const id of safe(() => [...index.sessions.keys()]) ?? []) ids.add(id)
  return ids
}

/** 存活会话各自的工作区根（面板靠工作区里的镜像显示回收站）。 */
function liveCwds(index) {
  const cwds = []
  for (const session of safe(() => [...index.sessions.values()]) ?? []) {
    const cwd = safe(() => session?.header?.cwd)
    if (typeof cwd === 'string' && cwd !== '') cwds.push(cwd)
  }
  return cwds
}

/**
 * 回收站变动后，把镜像刷新到每个存活会话的工作区里，供面板读取。
 * `deps.trashMirror === false` 时整体跳过（配置项 `trashMirror`）。
 */
function refreshMirrors(deps, index, home) {
  if (deps.trashMirror === false) return { skipped: true, written: [], failed: [] }
  const result = refreshTrashMirrors(home, liveCwds(index))
  return { skipped: false, written: result.written, failed: result.failed }
}

/** 从磁盘列出全部对话。 */
function listAllTool(index, deps) {
  return {
    name: 'conversation_list_all',
    description:
      'List EVERY conversation that exists on disk — including ones whose session is not loaded in this process — '
      + 'most recently active first, with title, workspace, size, whether it is currently running, and its folder path. '
      + 'Use this before conversation_delete to pick what to remove. Read-only.',
    parameters: params(
      {
        query: { type: 'string', description: 'Case-insensitive filter over title, first message, id, and workspace path.' },
        limit: { type: 'integer', description: 'Maximum rows (default 50, max 200).' },
        include_live: { type: 'boolean', description: 'Include conversations currently running in this process (default true).' },
      },
      [],
    ),
    output: OBJECT_OUTPUT,
    presentCall: () => card('Every conversation on disk', 'read'),
    async execute(args = {}) {
      const home = resolveHome(deps)
      if (home === undefined) return { error: homeError(deps) }
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const limit = coerceInt(args.limit, 50, 1, 200)
      const includeLive = coerceBool(args.include_live, true)
      let rows = listConversations(home, liveSessionIds(index))
      if (!includeLive) rows = rows.filter(row => !row.live)
      if (query !== '') {
        rows = rows.filter(row =>
          row.id.toLowerCase().includes(query)
          || String(row.title ?? '').toLowerCase().includes(query)
          || String(row.firstMessage ?? '').toLowerCase().includes(query)
          || String(row.workspace ?? '').toLowerCase().includes(query))
      }
      const total = rows.length
      const shown = rows.slice(0, limit).map((row, i) => ({
        seq: i + 1,
        id: row.id,
        title: row.title || '(untitled)',
        firstMessage: String(row.firstMessage ?? '').replace(/\s+/g, ' ').slice(0, 80),
        workspace: row.workspace,
        sizeKB: row.sizeKB,
        lastActivity: row.lastActivity ? new Date(row.lastActivity).toISOString() : null,
        running: row.live,
        path: row.dir,
      }))
      return {
        dshHome: home,
        total,
        shown: shown.length,
        conversations: shown,
        note: 'seq 只在本次结果内有效；要删除请传 id（更稳）或本次的 seq。运行中的对话不会被删除。',
      }
    },
  }
}

/** 删除对话（默认移入回收站）。 */
function deleteTool(index, deps) {
  return {
    name: 'conversation_delete',
    description:
      'Delete conversations. RECOVERABLE by default: they are moved into the recycle bin under $DSH_HOME/session-trash '
      + '(recover with conversation_restore); pass permanent:true to erase for good. Requires confirm:true. '
      + 'Refuses conversations that are currently running in this process. '
      + 'Pass session_ids (preferred) or seq numbers from the most recent conversation_list_all result.',
    parameters: params(
      {
        session_ids: { type: 'array', items: { type: 'string' }, description: 'Conversation ids to delete.' },
        seq: { type: 'array', items: { type: 'integer' }, description: 'Row numbers from the latest conversation_list_all call (1-based).' },
        confirm: { type: 'boolean', description: 'Must be true — the explicit confirmation latch.' },
        permanent: { type: 'boolean', description: 'Erase instead of moving into the recycle bin (default false).' },
      },
      [],
    ),
    output: OBJECT_OUTPUT,
    presentCall: () => card('Delete conversations', 'write'),
    async execute(args = {}) {
      if (coerceBool(args.confirm, false) !== true) {
        return { refused: true, reason: 'confirm:true is required; nothing was deleted.' }
      }
      const home = resolveHome(deps)
      if (home === undefined) return { error: homeError(deps) }
      const permanent = coerceBool(args.permanent, false)
      const live = liveSessionIds(index)
      const rows = listConversations(home, live)

      const wanted = new Set()
      for (const id of Array.isArray(args.session_ids) ? args.session_ids : []) {
        if (typeof id === 'string' && id !== '') wanted.add(id)
      }
      const unknown = []
      for (const raw of Array.isArray(args.seq) ? args.seq : []) {
        const n = coerceInt(raw, 0, 0, Number.MAX_SAFE_INTEGER)
        const hit = rows[n - 1]
        if (hit) wanted.add(hit.id)
        else unknown.push(`seq ${n}`)
      }
      if (wanted.size === 0) {
        return { error: 'no targets: pass session_ids or seq (get them from conversation_list_all)', unknown }
      }

      const targets = []
      const notFound = []
      const refusedLive = []
      for (const id of wanted) {
        const row = rows.find(candidate => candidate.id === id)
        if (!row) { notFound.push(id); continue }
        if (row.live) { refusedLive.push({ id, reason: 'currently running in this process' }); continue }
        targets.push(row)
      }
      if (targets.length === 0) {
        return {
          deleted: [], refusedLive, notFound: [...notFound, ...unknown],
          note: permanent ? 'nothing to erase' : 'nothing to delete',
        }
      }

      const result = moveToTrash(home, targets, { permanent })
      // 回收站变了：把镜像刷新到各存活会话的工作区，面板刷新后就能看到新内容。
      const mirror = refreshMirrors(deps, index, home)
      return {
        mode: permanent ? 'permanent' : 'recycle-bin',
        batch: result.batch,
        recycleBin: permanent ? null : result.trashDir,
        deleted: result.moved.map(entry => ({ id: entry.id, title: entry.title, workspace: entry.workspace, sizeKB: entry.sizeKB })),
        erased: result.purged,
        refusedLive,
        notFound: [...notFound, ...unknown],
        failed: result.failed,
        mirror,
        note: permanent
          ? '已永久删除，无法恢复。'
          : '已移入回收站（可恢复）：在同一目录的 MANIFEST.json 里记录着原始位置；用 conversation_restore 可原样恢复。原生列表不会自己更新（它只在重连时重拉）：在对话管理器面板点一下「刷新」，那些行立刻消失，不必重启。',
      }
    },
  }
}

/** 从回收站恢复。 */
function restoreTool(index, deps) {
  return {
    name: 'conversation_restore',
    description:
      'Restore conversations deleted by conversation_delete — default the newest recycle-bin batch, or pass a batch name '
      + 'from conversation_list_all/previous output. Never overwrites an occupied original path. '
      + 'The client list shows them again after a restart or reconnect.',
    parameters: params(
      { batch: { type: 'string', description: 'Recycle-bin batch name (e.g. 20261001-194558); omit for the newest.' } },
      [],
    ),
    output: OBJECT_OUTPUT,
    presentCall: () => card('Restore deleted conversations', 'write'),
    async execute(args = {}) {
      const home = resolveHome(deps)
      if (home === undefined) return { error: homeError(deps) }
      const batch = typeof args.batch === 'string' && args.batch !== '' ? args.batch : undefined
      const result = restoreBatch(home, batch)
      // 回收站变了：刷新镜像，面板刷新后能看到最新批次列表。
      const mirror = refreshMirrors(deps, index, home)
      return { ...result, recycleBin: listTrashBatches(home), mirror }
    },
  }
}

/**
 * 永久删除回收站里的批次（不可恢复）。
 *
 * 为什么需要它：`conversation_delete` 只从 `sessions/` 找目标，而回收站里的对话已经不在
 * 那里了——所以「清空回收站」必须有独立入口，否则用户只能去文件管理器手删目录。
 */
function purgeTool(index, deps) {
  return {
    name: 'conversation_purge',
    description:
      'Permanently delete recycle-bin batches. IRREVERSIBLE — these conversations can no longer be restored. '
      + 'Requires confirm:true. Pass all:true to empty the whole bin, or batch:"<name>" for one batch '
      + '(batch names come from conversation_delete / conversation_restore output).',
    parameters: params(
      {
        batch: { type: 'string', description: 'Recycle-bin batch name to erase (e.g. 20261001-203921).' },
        all: { type: 'boolean', description: 'Erase every batch — empties the recycle bin.' },
        confirm: { type: 'boolean', description: 'Must be true; permanent deletion has no undo.' },
      },
      [],
    ),
    output: OBJECT_OUTPUT,
    presentCall: () => card('Empty the recycle bin', 'write'),
    async execute(args = {}) {
      if (coerceBool(args.confirm, false) !== true) {
        return { refused: true, reason: 'confirm:true is required; nothing was erased.' }
      }
      const home = resolveHome(deps)
      if (home === undefined) return { error: homeError(deps) }
      const all = coerceBool(args.all, false)
      const batch = typeof args.batch === 'string' && args.batch !== '' ? args.batch : undefined
      if (!all && batch === undefined) {
        return {
          error: 'nothing to erase: pass all:true to empty the bin, or batch:"<name>" for one batch',
          available: listTrashBatches(home).map(entry => entry.batch),
        }
      }
      const result = purgeTrash(home, all ? { all: true } : { batch })
      // 回收站变了：刷新镜像，面板刷新后就能看到少掉的批次。
      const mirror = refreshMirrors(deps, index, home)
      return {
        ...result,
        recycleBin: listTrashBatches(home),
        mirror,
        note: '已永久删除，无法恢复；磁盘空间已释放。',
      }
    },
  }
}
