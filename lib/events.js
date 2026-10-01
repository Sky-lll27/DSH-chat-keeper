/**
 * 会话日志的读取与投影工具。
 *
 * 设计约束：这里只用 DSH 公开文档描述过的形状（Session / SessionEvent /
 * SessionEventMap），并且任何一次读取失败都降级为「读不到」，绝不向上抛异常。
 * 插件的监听器在宿主的事件分发里运行，抛出会污染别人的分发链。
 */

/** 执行 f()，异常时返回 fallback。 */
export function safe(f, fallback = undefined) {
  try {
    return f()
  } catch {
    return fallback
  }
}

/** 把可能是 Promise 的读取结果统一成同步可用的数组。 */
function asArray(value) {
  return Array.isArray(value) ? value : []
}

/**
 * 官方文档提到的 `session.snapshotEvents()`。
 *
 * ⚠️ 在本机 app.asar 里的实际发布声明中，`snapshotEvents()`、`eventAt()`、`ownEvents()`
 * **已被标记为弃用**，策略原文是「现有逻辑可以暂不迁移，但禁止新增生产调用」。
 * 因此本插件默认不走它：历史用 `session.deriveMessages()`、长度用 `session.seq`。
 * 只有这些非弃用读法不可用时（或用户显式开启 deepScan）才退化到这里。
 */
export function readEvents(session) {
  if (!session) return []
  const snapshot = safe(() =>
    typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : undefined,
  )
  if (Array.isArray(snapshot)) return snapshot
  if (Array.isArray(session.events)) return session.events
  return asArray(session.log)
}

/** readEvents 的异步版本：兼容返回 Promise 的实现。 */
export async function readEventsAsync(session) {
  if (!session) return []
  const snapshot = await safeAsync(() =>
    typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : undefined,
  )
  if (Array.isArray(snapshot)) return snapshot
  return readEvents(session)
}

/** 执行可能是异步的 f()，异常时返回 fallback。 */
export async function safeAsync(f, fallback = undefined) {
  try {
    return await f()
  } catch {
    return fallback
  }
}

/**
 * 把 ContentBlock[]（或字符串）压平成可读文本。
 *
 * 依据官方 llm-streaming 文档：`ContentBlockMap` 的标签是
 * `text` / `reasoning` / `image` / `file` / `tool-call` / `tool-addition` / `tool-removal`。
 * 只有 `text` 块带可见的 `text` 字段；`reasoning` 块的内容在 `thinking` 字段里，
 * 属于不可见的推理，不进摘要。
 */
export function blockText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'reasoning') continue
    if (typeof block.text === 'string' && block.text) {
      parts.push(block.text)
      continue
    }
    if (block.type === 'image') parts.push('[image]')
    else if (block.type === 'file') parts.push('[file]')
  }
  return parts.join('\n')
}

/**
 * 会话日志 → 有序的、可读的消息列表（跳过边界标记与请求头等纯日志事件）。
 */
export function projectMessages(events, options = {}) {
  const { limit = 50, includeTools = false, withToolResults = false } = options
  const projected = []
  for (const event of asArray(events)) {
    if (!event || typeof event !== 'object') continue
    const data = event.data ?? {}
    let entry = null
    switch (event.type) {
      case 'user/message':
        entry = { role: 'user', seq: event.seq, time: event.time, source: sourceName(data.source), text: blockText(data.content) }
        break
      case 'assistant/message':
        entry = {
          role: 'assistant',
          seq: event.seq,
          time: event.time,
          text: blockText(data.message?.content),
          interrupted: data.interrupted === true,
        }
        break
      case 'tool/call':
        if (!includeTools) break
        entry = { role: 'tool-call', seq: event.seq, time: event.time, name: data.name, arguments: truncate(String(data.arguments ?? ''), 400), callId: data.callId }
        break
      case 'tool/result':
        if (!includeTools || !withToolResults) break
        entry = { role: 'tool-result', seq: event.seq, time: event.time, text: truncate(blockText(data.message?.content), 400), isError: data.message?.isError === true }
        break
      default:
        break
    }
    if (entry) projected.push(entry)
  }
  if (limit > 0 && projected.length > limit) return projected.slice(projected.length - limit)
  return projected
}

/** 统计一份日志里各类事件的数量与工具调用数。 */
export function countEvents(events) {
  const byType = Object.create(null)
  let toolCalls = 0
  for (const event of asArray(events)) {
    if (!event || typeof event.type !== 'string') continue
    byType[event.type] = (byType[event.type] ?? 0) + 1
    if (event.type === 'tool/call') toolCalls += 1
  }
  // total 是数组长度（含形状不对的条目），byType 只统计带字符串 type 的条目，
  // 两者口径不同是有意的：前者反映「日志有多长」，后者反映「认得的事件有多少」。
  return { total: asArray(events).length, byType, toolCalls }
}

/** 该事件类型是否在**核心投影**的词表里（不含各插件合并进来的扩展事件）。 */
export function isCoreEventType(type) {
  return typeof type === 'string' && CORE_EVENT_TYPES.has(type)
}

/**
 * 官方发布声明里的核心会话事件类型。
 *
 * 这份清单是从本机 `app.asar` 里实际的 `interface SessionEventMap` 声明逐字核对的
 * （2026-09 的构建），不是从文档抄的。
 *
 * 注意：`SessionEventMap` 是**可合并扩展**的，实际运行时还会出现大量合法事件
 * （`agent/inbox/spliced`、`tool/ptc-dispatch`、`command/run`、`session/title`、
 * `approval/*`、`hook/*`、`compaction/*` …）。它们不是错误，只是本插件的投影不处理。
 * 因此判断「词表是否对得上」的依据不是「有没有陌生类型」，而是「有没有命中过核心类型」。
 */
export const CORE_EVENT_TYPES = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'user/message',
  'developer/message',
  'system/message',
  'assistant/message',
  'assistant/attempt',
  'tool/call',
  'tool/result',
  'request/header',
  'request/context',
  'session/end-seed',
])

/** 读取会话日志的当前长度（非弃用读法：`session.seq`）。 */
export function logLength(session) {
  const seq = safe(() => session?.seq)
  if (typeof seq === 'number' && Number.isFinite(seq)) return seq
  return readEvents(session).length
}

/**
 * 读取会话的模型可见历史。
 *
 * 优先用**非弃用**的 `session.deriveMessages(): Message[]`（已按 surface 折叠、
 * 带正确的 role/source）；只有当它不存在时，才退化成在事件日志上自行投影。
 */
export function deriveHistory(session, options = {}) {
  const derived = safe(() => (typeof session?.deriveMessages === 'function' ? session.deriveMessages() : undefined))
  if (Array.isArray(derived)) return { messages: derived, source: 'deriveMessages', projected: false }
  return {
    messages: projectMessages(readEvents(session), { limit: 0, includeTools: true, withToolResults: true, ...options }),
    source: 'events',
    projected: true,
  }
}

/** 从一条消息的 content 里抽出工具调用块（assistant 消息携带 tool-call 块）。 */
export function messageToolCalls(message) {
  const content = safe(() => message?.content)
  if (!Array.isArray(content)) return []
  const calls = []
  for (const block of content) {
    if (!block || typeof block !== 'object' || block.type !== 'tool-call') continue
    calls.push({
      id: safe(() => block.id) ?? null,
      name: safe(() => block.name) ?? null,
      arguments: truncate(String(safe(() => block.arguments) ?? ''), 400),
    })
  }
  return calls
}

/** 把一条 Message（deriveMessages 的产物）或投影条目统一成对外可读形状。 */
export function toReadableMessage(message) {
  if (!message || typeof message !== 'object') return null
  const entry = {
    role: typeof message.role === 'string' ? message.role : 'unknown',
    text: blockText(message.content ?? message.text),
  }
  if (typeof message.seq === 'number') entry.seq = message.seq
  if (typeof message.time === 'number') entry.time = message.time
  if (typeof message.id === 'string') entry.id = message.id
  const source = sourceName(message.source)
  if (source) entry.source = source
  if (message.isError === true) entry.isError = true
  if (typeof message.toolCallId === 'string') entry.toolCallId = message.toolCallId
  return entry
}

/** 按消息统计 user / assistant 条数与工具调用数（非弃用路径下的计数来源）。 */
export function countFromMessages(messages) {
  let userMessages = 0
  let assistantMessages = 0
  let toolCalls = 0
  for (const message of asArray(messages)) {
    if (message?.role === 'user') userMessages += 1
    else if (message?.role === 'assistant') assistantMessages += 1
    toolCalls += messageToolCalls(message).length
  }
  return { userMessages, assistantMessages, toolCalls }
}

/**
 * 累加某条消息里适配器上报的 usage 数字。
 *
 * 依据官方 llm-streaming 文档，`TokenUsage` 的字段是
 * `inputTokens` / `outputTokens` / `totalTokens?` / `cacheReadTokens?` /
 * `cacheWriteTokens?` / `reasoningTokens?`，且**各计数互不重叠**：
 * `inputTokens` 只含未缓存输入，计费输入 = 三者之和；而 `reasoningTokens`
 * 已经包含在 `outputTokens` 里，**汇总时不得再加一次**。
 *
 * 因此这里只做「逐字段分别求和」，既不把字段相加成一个总量，也不重复计
 * reasoning：调用方拿到的每个键都保持文档定义的语义。
 */
export function accumulateUsage(target, usage) {
  if (!usage || typeof usage !== 'object') return target
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      target[key] = (target[key] ?? 0) + value
    }
  }
  return target
}

/** 按文档口径推导「计费输入」= 未缓存输入 + 缓存读 + 缓存写（缺省按 0 计）。 */
export function billableInputTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  const sum = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return sum(usage.inputTokens) + sum(usage.cacheReadTokens) + sum(usage.cacheWriteTokens)
}

/** MessageSource 是一个可辨识联合，取它的判别标签做展示。 */
function sourceName(source) {
  if (typeof source === 'string') return source
  if (source && typeof source === 'object' && typeof source.kind === 'string') return source.kind
  return undefined
}

/** 截断长文本，附带省略长度标记。 */
export function truncate(text, max = 160) {
  if (typeof text !== 'string') return ''
  const cap = Number.isFinite(max) && max > 0 ? max : 160
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}… (+${text.length - cap} chars)`
}

/** 取会话的工作目录（SessionHeader.cwd），读不到返回 undefined。 */
export function sessionCwd(session) {
  const cwd = safe(() => session?.header?.cwd)
  return typeof cwd === 'string' ? cwd : undefined
}
