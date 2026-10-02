/**
 * 磁盘层面的对话清理：列出、移入回收站、从回收站恢复。
 *
 * 为什么需要它：DSH 的产品界面只有「归档」，没有「删除」；但每个对话在磁盘上就是
 * 一个目录（对话正文）加一个投影缓存文件，所以文件层面的删除是可行的。
 *
 * 两条安全底线：
 *   1. **回收站式删除**——移动而非粉碎，并在批次目录里留下 MANIFEST.json，可原样恢复；
 *      `permanent` 才真删。
 *   2. 回收站放在 `$DSH_HOME/session-trash/`（与 sessions 同级、同一卷），
 *      因此移动是同卷 rename，不会出现跨盘复制中断的半成品。
 *
 * 只用 node 内建模块：插件位于 harness 源码树之外，裸模块解析到不了 @deepseek-ai/*。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { safe } from './events.js'

/**
 * 解析 `$DSH_HOME`。
 *
 * 为什么不能只读环境变量：**DSH 桌面应用的主进程里没有 `DSH_HOME`**
 * （实测：应用内 `process.env.DSH_HOME` 是空的，只有它派生的 shell 才有）。
 * 应用自己用 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()`，默认回退到 `~/.dsh`。
 * 本插件在 harness 源码树之外，导不到那个包，所以这里按候选顺序 + **存在性校验**来解析：
 * 只有当候选目录确实像一个 DSH home（含 `sessions` / `storages` / `profiles`）时才采用。
 *
 * @param {string} [injected] 注入的 home（配置或 apply 时的环境变量）
 * @returns {{ home?: string, tried: string[] }} 解析结果与试过的候选（便于如实报错）
 */
export function resolveDshHome(injected) {
  const candidates = []
  const push = (value) => {
    if (typeof value === 'string' && value !== '' && !candidates.includes(value)) candidates.push(value)
  }
  push(injected)
  push(safe(() => process.env.DSH_HOME))
  push(safe(() => process.env.DSH_HOME_DIR))
  push(safe(() => join(homedir(), '.dsh')))

  const looksLikeHome = (dir) => {
    try {
      return existsSync(join(dir, 'sessions'))
        || existsSync(join(dir, 'storages'))
        || existsSync(join(dir, 'profiles'))
    } catch {
      return false
    }
  }
  for (const candidate of candidates) {
    if (looksLikeHome(candidate)) return { home: candidate, tried: candidates }
  }
  return { tried: candidates }
}

/** 对话正文文件名（与本机 app.asar 里的实际布局一致）。 */
export const SESSION_LOG_NAME = 'session.v4.jsonl.zstd'

/** `$DSH_HOME/sessions`：按工作区分目录，每个对话一个子目录。 */
export function sessionsRoot(dshHome) {
  return join(dshHome, 'sessions')
}

/** `$DSH_HOME/storages/session_projcache/sessions`：标题 / cwd / 创建时间的来源。 */
export function projCacheRoot(dshHome) {
  return join(dshHome, 'storages', 'session_projcache', 'sessions')
}

/** `$DSH_HOME/session-trash`：回收站根。 */
export function trashRoot(dshHome) {
  return join(dshHome, 'session-trash')
}

/**
 * 工作区目录名只是「编码后的 cwd」，且会丢字符，所以只在拿不到缓存里的 cwd 时兜底显示。
 * 形如 `--C-Users-me-projects-demo--`；非 ASCII 字符按 UTF-16 码元转义成 `~XXXX~`。
 */
export function decodeWorkspaceKey(key) {
  return String(key)
    .replace(/^--|--$/g, '')
    .replace(/~([0-9A-Fa-f]{4})~/g, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/-/g, '\\')
}

/** 目录（含子项）的总字节数。 */
function sizeOf(path) {
  let total = 0
  const walk = (p) => {
    for (const entry of safe(() => readdirSync(p, { withFileTypes: true })) ?? []) {
      const child = join(p, entry.name)
      if (entry.isDirectory()) walk(child)
      else total += safe(() => statSync(child).size) ?? 0
    }
  }
  walk(path)
  return total
}

/** 读一条投影缓存，取出标题、首条用户消息、cwd、创建时间。 */
function readProjection(dshHome, sessionId) {
  const file = join(projCacheRoot(dshHome), `${sessionId}.json`)
  if (!existsSync(file)) return undefined
  const parsed = safe(() => JSON.parse(readFileSync(file, 'utf8')))
  const record = parsed?.record
  if (!record) return undefined
  const rows = record.rows ?? {}
  return {
    title: typeof rows.title?.val === 'string' ? rows.title.val : undefined,
    first: typeof rows.titleInput?.val?.first?.text === 'string' ? rows.titleInput.val.first.text : undefined,
    cwd: typeof record.identity?.cwd === 'string' ? record.identity.cwd : undefined,
    createdAt: typeof record.identity?.createdAt === 'number' ? record.identity.createdAt : undefined,
  }
}

/**
 * 从磁盘列出全部对话（不依赖任何插件内存状态，因此重启后依然完整）。
 * @param dshHome - `$DSH_HOME`
 * @param liveIds - 当前进程里存活的会话 id 集合（用于标注「正在运行」，删除时会被拒绝）
 */
export function listConversations(dshHome, liveIds = new Set()) {
  const root = sessionsRoot(dshHome)
  const out = []
  if (!existsSync(root)) return out
  for (const ws of safe(() => readdirSync(root, { withFileTypes: true })) ?? []) {
    if (!ws.isDirectory()) continue
    const wsDir = join(root, ws.name)
    for (const s of safe(() => readdirSync(wsDir, { withFileTypes: true })) ?? []) {
      if (!s.isDirectory()) continue
      const dir = join(wsDir, s.name)
      const logPath = join(dir, SESSION_LOG_NAME)
      const cacheFile = join(projCacheRoot(dshHome), `${s.name}.json`)
      const cache = readProjection(dshHome, s.name)
      const mtime = safe(() => statSync(dir).mtimeMs) ?? 0
      out.push({
        id: s.name,
        title: cache?.title ?? '',
        firstMessage: cache?.first ?? '',
        workspace: cache?.cwd ?? decodeWorkspaceKey(ws.name),
        workspaceKey: ws.name,
        createdAt: cache?.createdAt ?? null,
        lastActivity: mtime,
        sizeKB: Math.round(sizeOf(dir) / 102.4) / 10,
        hasLog: existsSync(logPath),
        hasProjection: existsSync(cacheFile),
        live: liveIds.has(s.name),
        dir,
        cacheFile,
      })
    }
  }
  out.sort((a, b) => b.lastActivity - a.lastActivity)
  return out
}

/** 时间戳目录名。 */
function stampOf(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

/**
 * 把若干对话移入回收站（或永久删除）。
 *
 * @param dshHome - `$DSH_HOME`
 * @param targets - `listConversations` 的条目（必须带 dir / cacheFile / workspaceKey / id）
 * @param options - `{ permanent?: boolean, batch?: string, now?: Date }`
 * @returns `{ batch, trashDir, moved, purged, failed }`
 */
export function moveToTrash(dshHome, targets, options = {}) {
  const permanent = options.permanent === true
  const batch = options.batch ?? stampOf(options.now ?? new Date())
  const trashDir = join(trashRoot(dshHome), batch)
  const moved = []
  const purged = []
  const failed = []

  for (const target of targets) {
    try {
      if (permanent) {
        if (existsSync(target.dir)) rmSync(target.dir, { recursive: true, force: true })
        if (target.cacheFile && existsSync(target.cacheFile)) rmSync(target.cacheFile, { force: true })
        purged.push(target.id)
        continue
      }
      // 同卷 rename：先把正文目录搬到回收站，再搬投影缓存。
      const dirDest = join(trashDir, 'sessions', target.workspaceKey, target.id)
      mkdirSync(join(dirDest, '..'), { recursive: true })
      if (existsSync(target.dir)) renameSync(target.dir, dirDest)
      let cacheDest = null
      if (target.cacheFile && existsSync(target.cacheFile)) {
        mkdirSync(join(trashDir, 'projcache'), { recursive: true })
        cacheDest = join(trashDir, 'projcache', `${target.id}.json`)
        renameSync(target.cacheFile, cacheDest)
      }
      moved.push({
        id: target.id,
        title: target.title,
        workspace: target.workspace,
        workspaceKey: target.workspaceKey,
        sizeKB: target.sizeKB,
        from: target.dir,
        to: dirDest,
        cacheFrom: target.cacheFile ?? null,
        cacheTo: cacheDest,
      })
    } catch (error) {
      failed.push({ id: target.id, error: String(error?.message ?? error) })
    }
  }

  if (!permanent && moved.length > 0) {
    mkdirSync(trashDir, { recursive: true })
    const manifest = {
      batch,
      at: (options.now ?? new Date()).toISOString(),
      dshHome,
      count: moved.length,
      entries: moved,
    }
    writeFileSync(join(trashDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8')
  }

  return { batch, trashDir, moved, purged, failed }
}

/**
 * 列出回收站里的批次。
 *
 * `entries` 报的是**实际还留在批次里的对话数**（数 `sessions/<工作区>/<会话>` 目录），
 * 而不是 MANIFEST 里记的条数——恢复之后清单不会变，但里面的东西已经搬走了。
 * 于是"恢复完的空批次"既不会被列出来（面板不会显示一个空批次），
 * 也不会出现在清空的目标里。
 */
export function listTrashBatches(dshHome) {
  const root = trashRoot(dshHome)
  if (!existsSync(root)) return []
  const out = []
  for (const entry of safe(() => readdirSync(root, { withFileTypes: true })) ?? []) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const manifestFile = join(dir, 'MANIFEST.json')
    const manifest = existsSync(manifestFile) ? safe(() => JSON.parse(readFileSync(manifestFile, 'utf8'))) : undefined
    const remaining = countRemaining(dir)
    // 空批次（条目已全部恢复）不再列出：它没有可恢复或可清空的内容。
    if (remaining === 0) continue
    out.push({
      batch: entry.name,
      dir,
      entries: remaining,
      declared: Array.isArray(manifest?.entries) ? manifest.entries.length : null,
      at: typeof manifest?.at === 'string' ? manifest.at : null,
      sizeKB: Math.round(sizeOf(dir) / 102.4) / 10,
      restorable: manifest !== undefined,
    })
  }
  out.sort((a, b) => (b.batch ?? '').localeCompare(a.batch ?? ''))
  return out
}

/** 数一个批次里还剩几个对话目录（`<批次>/sessions/<工作区>/<会话>`）。 */
function countRemaining(batchDir) {
  const sessionsDir = join(batchDir, 'sessions')
  let count = 0
  for (const workspace of safe(() => readdirSync(sessionsDir, { withFileTypes: true })) ?? []) {
    if (!workspace.isDirectory()) continue
    for (const item of safe(() => readdirSync(join(sessionsDir, workspace.name), { withFileTypes: true })) ?? []) {
      if (item.isDirectory()) count += 1
    }
  }
  return count
}

/**
 * 从回收站恢复一个批次（默认恢复最新的一批）。
 * @returns `{ batch, restored, skipped, failed }`
 */
export function restoreBatch(dshHome, batch) {
  const batches = listTrashBatches(dshHome)
  const chosen = batch !== undefined ? batches.find(b => b.batch === batch) : batches[0]
  if (!chosen) return { batch: batch ?? null, restored: [], skipped: [], failed: [], error: '没有可恢复的回收站批次' }
  const manifestFile = join(chosen.dir, 'MANIFEST.json')
  const manifest = safe(() => JSON.parse(readFileSync(manifestFile, 'utf8')))
  if (!manifest) return { batch: chosen.batch, restored: [], skipped: [], failed: [], error: '该批次没有 MANIFEST.json，无法自动恢复（可手动从回收站拷回）' }

  const restored = []
  const skipped = []
  const failed = []
  for (const entry of manifest.entries ?? []) {
    try {
      if (!existsSync(entry.to)) {
        skipped.push({ id: entry.id, reason: '回收站里已不存在' })
        continue
      }
      if (existsSync(entry.from)) {
        skipped.push({ id: entry.id, reason: '原位置已被占用，未覆盖' })
        continue
      }
      mkdirSync(join(entry.from, '..'), { recursive: true })
      renameSync(entry.to, entry.from)
      if (entry.cacheTo && entry.cacheFrom && existsSync(entry.cacheTo)) {
        mkdirSync(join(entry.cacheFrom, '..'), { recursive: true })
        if (!existsSync(entry.cacheFrom)) renameSync(entry.cacheTo, entry.cacheFrom)
      }
      restored.push({ id: entry.id, to: entry.from })
    } catch (error) {
      failed.push({ id: entry.id, error: String(error?.message ?? error) })
    }
  }
  // 全部搬回去之后，批次目录就没有存在意义了（只剩清单与缓存），顺手清掉，
  // 免得回收站里堆着一堆"看起来还有东西"的空壳。
  if (failed.length === 0 && skipped.length === 0 && restored.length > 0 && countRemaining(chosen.dir) === 0) {
    safe(() => rmSync(chosen.dir, { recursive: true, force: true }))
  }
  return { batch: chosen.batch, restored, skipped, failed }
}

/**
 * 永久删除回收站里的批次（不可恢复）。
 *
 * 为什么需要它：`conversation_delete` 只从 `sessions/` 找目标，回收站里的对话已经不在那里，
 * 所以「清空回收站」必须有独立入口，否则只能去文件管理器手删。
 *
 * 安全措施：只接受 `listTrashBatches()` 报出的批次名（那是在回收站根下**枚举**出来的），
 * 并对最终路径做一次包含性校验——绝不允许 `..` 之类把它带到回收站之外。
 *
 * @param dshHome - `$DSH_HOME`
 * @param options - `{ batch?: string, all?: boolean }`；`all` 清空全部，否则删指定批次
 * @returns `{ purged, freedKB, failed }`
 */
export function purgeTrash(dshHome, options = {}) {
  const root = trashRoot(dshHome)
  const batches = listTrashBatches(dshHome)
  const chosen = options.all === true
    ? batches
    : batches.filter(entry => entry.batch === options.batch)
  if (chosen.length === 0) {
    return {
      purged: [], freedKB: 0, failed: [],
      error: options.all === true ? '回收站已经是空的' : `没找到批次 ${JSON.stringify(options.batch ?? null)}`,
      available: batches.map(entry => entry.batch),
    }
  }

  const purged = []
  const failed = []
  let freedBytes = 0
  for (const entry of chosen) {
    try {
      // 包含性校验：目标必须真的是回收站根下的直接子目录。
      const parent = dirname(entry.dir)
      if (parent !== root || basename(entry.dir) !== entry.batch) {
        failed.push({ batch: entry.batch, error: '拒绝：路径不在回收站根下' })
        continue
      }
      const bytes = sizeOf(entry.dir)
      rmSync(entry.dir, { recursive: true, force: true })
      freedBytes += bytes
      purged.push({ batch: entry.batch, entries: entry.entries, sizeKB: entry.sizeKB })
    } catch (error) {
      failed.push({ batch: entry.batch, error: String(error?.message ?? error) })
    }
  }
  // 一批不剩时把回收站根目录也收掉：留着空壳只会让人以为里面还有东西。
  if (failed.length === 0 && purged.length > 0) {
    const left = safe(() => readdirSync(root).length)
    if (left === 0) safe(() => rmSync(root, { recursive: true, force: true }))
  }
  return { purged, freedKB: Math.round(freedBytes / 102.4) / 10, failed }
}
