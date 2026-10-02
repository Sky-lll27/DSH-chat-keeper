/**
 * 磁盘层面的**正文**搜索：读会话日志，做大小写不敏感的字面子串匹配。
 *
 * 与 DSH 自带内容索引的分工（README 有完整对比）：
 *   - 自带索引跑在 SQLite FTS5 上，分词器是 `unicode61`。它把**一整串连续中文当一个词元**，
 *     于是"在「内容检索示例」里搜「检索」"搜不到（实测：整段命中、子串 0 命中）。
 *   - 本模块是字面子串匹配，**与语言无关**：中文子串、英文片段、路径片段都能命中；
 *     而且直接读磁盘日志，因此**冷对话（未装载的会话）也能搜**。
 *
 * 代价是"逐个读日志"比查索引慢，所以这里自带三道刹车：
 *   `maxConversations`（最多读几个对话）、`budgetMs`（时间预算）、按最近活动倒序（先搜最可能相关的）。
 * 超出预算时**如实报告 `timedOut`**，而不是假装"搜完了没有"。
 */
import { join } from 'node:path'
import { SESSION_LOG_NAME, listConversations } from './cleanup.js'
import { eventText, readEventsFromFile } from './log-read.js'

/** 在文本里找一个大小写不敏感的字面子串，返回位置与上下文片段。 */
function findSnippet(text, needle, radius = 60) {
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return undefined
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + needle.length + radius)
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${raw}${end < text.length ? '…' : ''}`
}

/** 数一段文本里出现几次目标（大小写不敏感、不重叠）。 */
function countMatches(text, needle) {
  const haystack = text.toLowerCase()
  const target = needle.toLowerCase()
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(target, from)
    if (at < 0) return count
    count += 1
    from = at + target.length
  }
}

/**
 * 搜索磁盘上所有对话的正文与元数据。
 *
 * @param dshHome - `$DSH_HOME`
 * @param query - 查询词（字面子串，不区分大小写）
 * @param options - `{ liveIds, maxConversations, budgetMs, limit }`
 * @returns `{ hits, scanned, unreadable, timedOut, elapsedMs }`
 */
export function searchConversationsOnDisk(dshHome, query, options = {}) {
  const startedAt = Date.now()
  const budgetMs = typeof options.budgetMs === 'number' ? options.budgetMs : 5000
  const maxConversations = typeof options.maxConversations === 'number' ? options.maxConversations : 60
  const limit = typeof options.limit === 'number' ? options.limit : 20
  const needle = String(query ?? '')
  const empty = { hits: [], scanned: 0, unreadable: [], timedOut: false, elapsedMs: 0 }
  if (needle === '') return empty

  const all = listConversations(dshHome, options.liveIds ?? new Set())
  // 最近活动的对话先搜：预算被用光时，命中的更可能是你想找的。
  const rows = [...all].sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)).slice(0, maxConversations)

  const hits = []
  const unreadable = []
  let scanned = 0
  let timedOut = false

  for (const row of rows) {
    if (Date.now() - startedAt > budgetMs) {
      timedOut = true
      break
    }
    let matches = 0
    let snippet
    /** 首次命中的事件位置：让调用方能够"跳到命中处"（`loadThrough(seq)`）或读它前后几条。 */
    let firstSeq
    let firstTime
    let firstType
    const titleHit = findSnippet(String(row.title ?? ''), needle)
    const workspaceHit = findSnippet(String(row.workspace ?? ''), needle)
    if (titleHit !== undefined) {
      matches += countMatches(String(row.title ?? ''), needle)
      snippet ??= titleHit
    }
    if (workspaceHit !== undefined) {
      matches += countMatches(String(row.workspace ?? ''), needle)
      snippet ??= workspaceHit
    }
    try {
      const { events } = readEventsFromFile(join(row.dir, SESSION_LOG_NAME))
      for (const event of events) {
        if (Date.now() - startedAt > budgetMs) {
          timedOut = true
          break
        }
        const text = eventText(event)
        if (text === undefined) continue
        const found = countMatches(text, needle)
        if (found === 0) continue
        matches += found
        if (snippet === undefined) snippet = findSnippet(text, needle)
        if (firstSeq === undefined && typeof event.seq === 'number') {
          firstSeq = event.seq
          firstTime = typeof event.time === 'number' ? event.time : undefined
          firstType = typeof event.type === 'string' ? event.type : undefined
        }
      }
    } catch (error) {
      unreadable.push({ id: row.id, error: String(error?.message ?? error) })
      continue
    }
    scanned += 1
    if (matches > 0) {
      hits.push({
        id: row.id,
        title: row.title ?? '',
        workspace: row.workspace ?? '',
        sizeKB: row.sizeKB ?? null,
        lastActivity: row.lastActivity ? new Date(row.lastActivity).toISOString() : null,
        running: row.live === true,
        matches,
        snippet,
        /** 命中处的事件序号/时间/类型（元数据命中时为 undefined）。 */
        seq: firstSeq,
        at: firstTime === undefined ? null : new Date(firstTime).toISOString(),
        eventType: firstType ?? null,
        source: 'disk',
      })
    }
    if (hits.length >= limit) break
  }

  hits.sort((a, b) => b.matches - a.matches || (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))
  return {
    hits: hits.slice(0, limit),
    scanned,
    unreadable,
    timedOut,
    elapsedMs: Date.now() - startedAt,
  }
}
