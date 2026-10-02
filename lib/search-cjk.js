/**
 * 中文（CJK）查询的字面兜底 —— 包在宿主 `sessions.search` 上。
 *
 * 为什么需要它：
 *   官方内容索引是 SQLite FTS5，两张表建表时分词器都写死 `tokenize = 'unicode61'`，
 *   查询再被 `quoteFtsData()` 包成一个**字面短语**送进 MATCH。unicode61 把连续字母串
 *   当作一个词元：英文单词天然被空格隔开，所以英文搜得准；中文整句连成一片，
 *   只有查询词**恰好等于**被标点或英文切出来的那一段时才命中 —— 于是"中文时好时坏"。
 *   （DSH 自己的 README 也写明：结果匹配 token 与短语，而非任意子字符串；
 *   要字面子串得用宿主侧 `ctx.sessionQuery.filterEvents()`，那条路浏览器半走不到。）
 *
 * 修在哪一层：
 *   **不动 DSH 的任何文件**，只在本插件的宿主半把 `sessions.search` 包一层：
 *   查询含 CJK 时，额外用 `searchConversationsOnDisk()`（字面子串、冷对话也能搜）
 *   补一批结果合并进去。官方放大镜与本插件面板走的是**同一个方法**，
 *   所以两处一起变好；纯英文查询连扫描都不触发，行为与从前逐字一致。
 *
 * 三条底线（与插件整体一致）：
 *   1. **失败不外溢**：兜底扫描出任何错，只记一条 warn，原样返回官方结果；
 *   2. **形状不认识就不动**：`base.items` 不是数组时原样返回，绝不猜别人的契约；
 *   3. **卸载即还原**：`restore()` 把方法放回原处（原本是继承来的就 delete 自己的属性）。
 */
import { resolveDshHome } from './cleanup.js'
import { searchConversationsOnDisk } from './search-disk.js'

/** 打过补丁的标记：防止同名方法被包两次（叠加会重复扫描）。 */
const PATCHED = Symbol.for('dsh-conversation-manager.cjk-search')

/**
 * CJK 判定：中日韩文字（含扩展 A 与扩展 B）与谚文。
 * 这些文字在 `unicode61` 下都会连成一个词元，正是需要兜底的那类查询。
 */
const CJK_PATTERN =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\u{20000}-\u{2fa1f}]/u

/**
 * 查询词里有没有需要兜底的文字。
 * @param {unknown} text
 * @returns {boolean}
 */
export function hasCjk(text) {
  if (typeof text !== 'string' || text === '') return false
  return CJK_PATTERN.test(text)
}

/**
 * 从宿主 `sessions.search(request, signal)` 的入参里取出查询词。
 * 宿主的实际签名是 `search({ query }, signal)`；这里对"直接传字符串"也兼容，
 * 免得哪天上游改了形状就静默失灵。
 *
 * @param {unknown} request
 * @returns {string} 已 trim 的查询词；取不到时返回空串（空串不会触发兜底）
 */
export function queryOf(request) {
  if (typeof request === 'string') return request.trim()
  if (request !== null && typeof request === 'object' && typeof request.query === 'string') {
    return request.query.trim()
  }
  return ''
}

/**
 * 按 **Unicode 码点**截断（与宿主 `truncateUnicodeCodePoints(snippet, 240)` 同一口径）。
 * 用 `Array.from` 而不是 `slice`，避免把代理对（生僻字、emoji）劈成半个字符。
 *
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
export function truncateCodePoints(text, max = 240) {
  const value = String(text ?? '')
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max).join('')
}

/**
 * 把字面扫描的命中合并进官方结果。
 *
 * 规则：
 *   - **官方结果原样在前**（官方排序与授权过滤不该被我打乱）；
 *   - 按 `sessionId` 去重：两边都有的会话**保留官方片段**（官方片段一定含查询词，
 *     而且它的高亮/排序是客户端认识的）；
 *   - 追加到 `cap`（默认 20，与官方 `authorized.slice(0, 20)` 同一上限）为止；
 *     放不下的置 `hasMore = true`，绝不谎称"没有更多"。
 *
 * @param {{ items?: unknown, hasMore?: unknown } | unknown} base 官方返回
 * @param {Array<{ id?: string, sessionId?: string, snippet?: unknown }>} extras 磁盘命中
 * @param {number} [cap]
 * @returns {unknown} 形状不认识时原样返回 base
 */
export function mergeSearchResults(base, extras, cap = 20) {
  if (base === null || typeof base !== 'object' || !Array.isArray(base.items)) return base
  const baseItems = base.items
  const items = baseItems.slice(0, cap)
  const seen = new Set()
  for (const item of items) {
    const id = item?.sessionId
    if (typeof id === 'string') seen.add(id)
  }
  let hasMore = base.hasMore === true || baseItems.length > cap
  for (const extra of Array.isArray(extras) ? extras : []) {
    const id = typeof extra?.id === 'string'
      ? extra.id
      : typeof extra?.sessionId === 'string'
        ? extra.sessionId
        : ''
    if (id === '' || seen.has(id)) continue
    if (items.length >= cap) {
      hasMore = true
      break
    }
    items.push({ sessionId: id, snippet: truncateCodePoints(extra.snippet, 240) })
    seen.add(id)
  }
  return { ...base, items, hasMore }
}

/**
 * 造一个"读磁盘做字面子串扫描"的函数，交给 {@link installCjkSearch} 的 `scan` 用。
 *
 * 扫描有三道刹车（见 `search-disk.js`）：最多读 `maxConversations` 个对话、
 * 时间预算 `budgetMs`、按最近活动倒序。超预算时它如实标 `timedOut`——
 * 这里只取能拿到的命中，**不谎称搜完了**。
 *
 * @param {{ budgetMs?: number, maxConversations?: number, limit?: number,
 *           resolveHome?: () => string | undefined }} [options]
 * @returns {(query: string, signal?: AbortSignal) => Array<{ id: string, snippet?: string }>}
 */
export function createCjkScanner(options = {}) {
  const budgetMs = typeof options.budgetMs === 'number' ? options.budgetMs : 2000
  const maxConversations = typeof options.maxConversations === 'number' ? options.maxConversations : 120
  const limit = typeof options.limit === 'number' ? options.limit : 20
  return function scan(query) {
    const home = typeof options.resolveHome === 'function'
      ? options.resolveHome()
      : resolveDshHome().home
    if (typeof home !== 'string' || home === '') return []
    const disk = searchConversationsOnDisk(home, query, { budgetMs, maxConversations, limit })
    return disk.hits.map((hit) => ({ id: String(hit?.id ?? ''), snippet: hit?.snippet }))
  }
}

/**
 * 把中文兜底装到 `target.search` 上。
 *
 * @param {{ search?: unknown } | null | undefined} target 宿主 `sessions` 服务
 * @param {{ scan?: (query: string, signal?: AbortSignal) => unknown, cap?: number,
 *           ttlMs?: number, log?: { warn?: (message: string) => void },
 *           onScan?: (info: { hits: number, added: number, elapsedMs: number, cached: boolean }) => void,
 *           now?: () => number }} [options]
 * @returns {{ installed: boolean, reason: string | null, restore: () => void }}
 */
export function installCjkSearch(target, options = {}) {
  if (target === null || target === undefined || typeof target.search !== 'function') {
    // 宿主没暴露 search（某些组合不挂会话控制器）：如实报告，不当成错误。
    return { installed: false, reason: 'search-unavailable', restore: () => {} }
  }
  if (target.search[PATCHED] === true) {
    return { installed: false, reason: 'already-patched', restore: () => {} }
  }

  const { scan, cap = 20, ttlMs = 8000, log, onScan, now = Date.now } = options
  const hadOwn = Object.prototype.hasOwnProperty.call(target, 'search')
  const original = target.search
  /** 同一个查询在短窗口内复用上次扫描，避免面板/放大镜各搜一次就扫两遍磁盘。 */
  let cache = null

  const patched = async function conversationManagerCjkSearch(request, signal) {
    // 官方结果先拿到：它抛错（查询非法、索引关闭、取消）时**必须原样往外抛**，
    // 兜底绝不改变官方的错误语义——README 里"索引关闭时如实回传错误码"仍然成立。
    const base = await original.call(target, request, signal)
    const query = queryOf(request)
    if (!hasCjk(query)) return base
    if (signal !== null && signal !== undefined && signal.aborted === true) return base
    // 官方已经给满一页时没有可加的余地，省掉一次磁盘扫描。
    if (Array.isArray(base?.items) && base.items.length >= cap) return base

    try {
      const at = now()
      let hits
      let elapsedMs = 0
      let cached = false
      if (cache !== null && cache.query === query && at - cache.at < ttlMs) {
        hits = cache.hits
        cached = true
      } else {
        const startedAt = now()
        hits = typeof scan === 'function' ? scan(query, signal) : []
        if (!Array.isArray(hits)) hits = []
        cache = { query, at, hits }
        elapsedMs = now() - startedAt
      }
      const merged = mergeSearchResults(base, hits, cap)
      if (typeof onScan === 'function') {
        const added = Array.isArray(merged?.items) && Array.isArray(base?.items)
          ? Math.max(0, merged.items.length - base.items.length)
          : 0
        // `cached` 让调用方把"真正读了磁盘"与"复用上次结果"分开计数。
        onScan({ hits: hits.length, added, elapsedMs, cached })
      }
      return merged
    } catch (error) {
      // 兜底的任何失败都不许影响官方搜索：只留一条可诊断的 warn。
      safeWarn(log, `中文搜索兜底失败（官方结果原样返回）：${String(error?.message ?? error)}`)
      return base
    }
  }
  Object.defineProperty(patched, PATCHED, { value: true })
  target.search = patched

  return {
    installed: true,
    reason: null,
    restore() {
      if (hadOwn) target.search = original
      else delete target.search
    },
  }
}

/**
 * 把中文兜底装到**一组候选**服务上，并汇总每个候选的状态。
 *
 * 为什么是一组（0.5.0 的教训）：网关把 `remote.session.search` 绑在
 * `super(ctx, "sessionController", { namespace: "session" })` 那个服务上，
 * 而 `ctx.sessions` 是会话存储（同步 `list()`），两者**不是同一个对象**。
 * 0.5.0 只包了 `sessions`，补丁一次都没被调用过 —— 面上一切正常，功能却是空的。
 * 所以这里把候选逐个列出、逐个装，并把每个候选的状态写进自检账本，
 * 让"装没装上"变成可以对账的数字，而不是靠猜。
 *
 * @param {Array<{ name: string, target: unknown }>} candidates
 * @param {object} [options] 同 {@link installCjkSearch}
 * @returns {{ installed: boolean, reason: string | null, targets: Record<string, string>,
 *             details: Array<{ name: string, status: string }>, restore: () => void }}
 */
export function installCjkSearchAll(candidates, options = {}) {
  const details = []
  const restores = []
  const seen = new Set()
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const name = String(candidate?.name ?? 'unnamed')
    const target = candidate?.target
    if (target === null || target === undefined) {
      details.push({ name, status: 'absent' })
      continue
    }
    if (seen.has(target)) {
      // 两个候选解析到同一个对象时只装一次（installCjkSearch 也有 PATCHED 记号兜底）。
      details.push({ name, status: 'same-as-before' })
      continue
    }
    seen.add(target)
    const outcome = installCjkSearch(target, options)
    restores.push(outcome.restore)
    // 重试时同一个对象会返回 already-patched：对我们来说它就是"装上了"，
    // 所以统一记成 installed，免得账本在第二次尝试后反而变难读。
    const status = outcome.installed || outcome.reason === 'already-patched'
      ? 'installed'
      : (outcome.reason ?? 'not-installed')
    details.push({ name, status })
  }
  const targets = {}
  for (const detail of details) targets[detail.name] = detail.status
  const installed = details.some((detail) => detail.status === 'installed')
  return {
    installed,
    reason: installed ? null : (details[0]?.status ?? 'no-target'),
    targets,
    details,
    restore() {
      for (const restore of restores) restore()
    },
  }
}

/** warn 也要包一层：诊断日志不该成为新的故障源。 */
function safeWarn(log, message) {
  try {
    if (typeof log?.warn === 'function') log.warn(message)
  } catch {
    /* 日志失败就吞掉 */
  }
}
