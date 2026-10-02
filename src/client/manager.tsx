/**
 * 对话管理器正文——右侧 Sidebar 页签 `conversation-manager` 的 body。
 *
 * 定位：只做**原生侧栏没有的事**——跨工作区总表、按时间批量、删除/恢复入口、回收站一览。
 * 搜索/筛选（除时间外）/排序/置顶/改名/分叉一律不做，原生侧栏已有。
 *
 * 两条能力边界（都是硬约束，不是偷懒）：
 *   1. 删除与恢复是**宿主的磁盘操作**，浏览器半没有文件访问权；面板只负责选择，
 *      然后复制一条**带确切 id 的指令**，由用户粘贴发送给宿主工具执行。
 *   2. 面板能读的只有**会话工作区内的文件**（`workspaceFiles` Remote）。所以回收站一览
 *      来自宿主写在工作区里的镜像 `.dsh-conversation-manager/trash.json`
 *      （见宿主半的 `lib/trash-mirror.js`；两半各自打包，路径在两处各写一份）。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NS } from './locale.ts'

/** 回收站镜像在工作区里的相对路径。宿主半的 `lib/trash-mirror.js` 写它，两边必须一致。 */
export const TRASH_MIRROR_PATH = '.dsh-conversation-manager/trash.json'

/**
 * 「显示已归档」开关的持久化键。
 *
 * 面板没有别的持久化通道（浏览器半没有文件权限），所以记住上一次的取舍只能靠
 * localStorage；它跨页签、跨重开都有效，取值就是 `'true'` / `'false'`。
 */
export const SHOW_ARCHIVED_KEY = 'dsh-conversation-manager/show-archived'

/** 操作结果（inject face 把宿主错误折叠成 JSON 结果，避免组件依赖 Remote 类型）。 */
export interface ActionResult {
  ok: boolean
  code?: string
  activity?: string
  message?: string
}

/** 读镜像的结果。 */
export interface MirrorReadResult {
  ok: boolean
  text?: string
  code?: string
  message?: string
  /** 试了几个会话 id（诊断用：多候选逐个尝试是这套读取的正常姿势）。 */
  tried?: number
}

/**
 * 一条正文命中。
 *
 * 字段说明：宿主的内容索引每条只回 `{ sessionId, snippet }`（snippet 截到 240 个码点），
 * 标题、工作区、状态都由客户端用已有的会话目录补齐——这一点是从宿主的
 * `authorized.push({ sessionId, snippet })` 里读出来的，不是猜的。
 */
export interface SearchHit {
  sessionId: SessionId
  snippet?: string
}

/** 正文搜索的结果。 */
export interface SearchOutcome {
  ok: boolean
  hits: SearchHit[]
  hasMore: boolean
  code?: string
  message?: string
}

/** apply 闭包投影给组件的能力。 */
export interface ManagerFace {
  openSession(id: SessionId): ActionResult
  setArchived(id: SessionId, archived: boolean, stopActivity?: boolean): Promise<ActionResult>
  /**
   * 读回收站镜像。传一串候选会话 id：框架不给页签正文"我是哪个会话"，
   * 而镜像是全局同一份，所以逐个试、命中即止。
   */
  readTrashMirror(ids: readonly SessionId[]): Promise<MirrorReadResult>
  /**
   * 搜索对话正文（走宿主已挂载的内容索引 Remote）。
   *
   * 注意：DSH 的全文索引是 opt-in 的（组合包默认 `openAt: never`）。索引没打开时
   * 宿主会以 `SESSION_QUERY_SEARCH_DISABLED` 之类的错误拒绝——面板会如实显示这句话，
   * 而不是假装"没有结果"。本插件的组合包 patch 会把索引打开，见 README。
   */
  searchContent(query: string, signal: AbortSignal): Promise<SearchOutcome>
  /** 重新拉取会话列表基线，让已从磁盘删除的行从原生列表里消失（不必重连）。 */
  refreshSessions(): Promise<ActionResult>
}

/* ── 结构镜像（与安装版运行时的字段逐一对齐，见 README 的核对清单） ── */

interface SessionRow {
  id: SessionId
  title?: string
  displayTitle: string
  cwd?: string
  parentId?: SessionId
  origin?: 'subagent'
  running: boolean
  blank: boolean
  updatedAt: number
}

interface SessionListSnapshot {
  ids: SessionId[]
  byId: Record<SessionId, SessionRow>
  phase: string
}

interface SessionStatusLike {
  running: boolean | undefined
  pendingInteraction: unknown
  completionUnread: boolean
}

interface WorkspaceViewLike {
  workspaceId: string
  title: string
  path: string
  sessionIds: readonly SessionId[]
}

interface WorkspaceSnapshotLike {
  items: readonly WorkspaceViewLike[]
  archivedSessionIds: readonly SessionId[]
  pinnedSessionIds: readonly SessionId[]
}

/** 宿主写在工作区里的回收站镜像。 */
interface TrashMirror {
  version?: number
  at?: string
  trashRoot?: string
  count?: number
  batches?: {
    batch: string
    at?: string | null
    entries?: number | null
    sizeKB?: number
    restorable?: boolean
  }[]
}

/** 时间筛选：只保留「最近活动早于 N 天」的会话；0 表示不筛。 */
type OlderThan = 0 | 7 | 30 | 90

export type ManagerProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS>
  & InjectFace<ManagerFace>

/** 相对时间文案。用 any 收口，避免与实际 t 的泛型签名冲突。 */
function relativeTime(ts: number, now: number, t: (key: any, params?: any) => string): string {
  if (!ts || ts <= 0) return ''
  const diff = Math.max(0, now - ts)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('justNow')
  if (minutes < 60) return t('minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('daysAgo', { n: days })
  return new Date(ts).toLocaleDateString()
}

/** 一行状态点：运行/等待交互/完成未读/空闲。label 传已翻译文案，供读屏与悬浮提示。 */
function StatusDot({ status, label }: { status: SessionStatusLike | undefined; label: string }) {
  let cls = 'dshm-dot dshm-dot--idle'
  if (status?.pendingInteraction) cls = 'dshm-dot dshm-dot--pending'
  else if (status?.running === true) cls = 'dshm-dot dshm-dot--running'
  else if (status?.completionUnread) cls = 'dshm-dot dshm-dot--done'
  return <span className={cls} role="img" aria-label={label} />
}

/**
 * 回收站镜像读取的"黑匣子"。
 *
 * 为什么需要：浏览器半跑在渲染进程里，宿主侧看不到它的状态，"标签卡在加载中"这类问题
 * 分不清是拿不到会话上下文、Remote 不可用、还是文件不存在。这里把每次读取的结果写进
 * localStorage（Electron 会落盘），离线也能读出来定位。只记诊断字段，不记任何会话内容。
 */
function probeTrash(entry: Record<string, unknown>): void {
  try {
    const key = 'dsh-conversation-manager/trash-probe'
    const raw = window.localStorage.getItem(key)
    const previous = raw === null ? [] : JSON.parse(raw) as unknown
    const log = (Array.isArray(previous) ? previous : []).slice(-4)
    log.push({ ...entry, at: new Date().toISOString() })
    window.localStorage.setItem(key, JSON.stringify(log))
  } catch {
    // 探针失败不该影响面板功能。
  }
}

/**
 * 复制文本到剪贴板。
 * 纯浏览器 API，不需要宿主能力——正是「面板负责选择、指令交给宿主」这条路的支点。
 * 先试异步剪贴板 API，失败再退回 execCommand（Electron 自定义协议下的兜底）。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* 落到下面的兜底 */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/**
 * 读「显示已归档」开关的上次取值。
 *
 * 缺省（没存过、存储被禁用、读取出错）一律返回 `true`——保持本插件一直以来的
 * 默认行为：已归档的对话照样列出来，只是带「已归档」徽标。
 */
function readShowArchived(): boolean {
  try {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(SHOW_ARCHIVED_KEY) !== 'false'
  } catch {
    return true
  }
}

/**
 * 在摘要片段里标出关键词。
 *
 * 为什么要有它：原生侧栏的搜索结果只把 snippet 原样渲染（见 ui-workspace 的
 * `searchResultSnippet`），不标出命中位置；长摘要在 20 条列表里很难扫。
 * 大小写不敏感、不区分全半角（按码元直接匹配，与宿主"字面匹配"的语义一致）。
 */
function highlightSnippet(text: string, query: string): ReactNode {
  if (query === '') return text
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  let key = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark className="dshm-mark" key={`hit-${key++}`}>{text.slice(at, at + needle.length)}</mark>)
    from = at + needle.length
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts
}

export function ManagerBody(props: ManagerProps) {
  const {
    t, useSessions, useSessionStatus, useWorkspaces, useSession,
    openSession, setArchived, readTrashMirror, refreshSessions, searchContent,
  } = props

  const listState = useSessions((s: unknown) => s) as unknown as SessionListSnapshot
  const statusMap = useSessionStatus((s: unknown) => s) as unknown as ReadonlyMap<SessionId, SessionStatusLike>
  const workspaces = useWorkspaces((w: unknown) => w) as unknown as WorkspaceSnapshotLike
  /**
   * 本页签所属的会话 id——读工作区文件需要它当 scope。
   * `useSession` 是 session 作用域的标准 prop；用 typeof 兜一道，避免某个版本没提供时整块白屏
   * （prop 的存在性在组件生命周期内不变，因此这个条件调用不会改变 hook 顺序）。
   */
  const sessionId = (typeof useSession === 'function'
    ? useSession((s: unknown) => (s as { sessionId?: SessionId } | undefined)?.sessionId)
    : undefined) as SessionId | undefined

  const archivedSet = useMemo(() => new Set(workspaces?.archivedSessionIds ?? []), [workspaces?.archivedSessionIds])
  const workspaceOf = useMemo(() => {
    const map = new Map<SessionId, WorkspaceViewLike>()
    for (const ws of workspaces?.items ?? []) {
      for (const sid of ws.sessionIds ?? []) if (!map.has(sid)) map.set(sid, ws)
    }
    return map
  }, [workspaces?.items])
  const workspaceTitleOf = (id: SessionId): string => workspaceOf.get(id)?.title ?? t('ungrouped')

  const [selected, setSelected] = useState<ReadonlySet<SessionId>>(new Set())
  const [stopConfirm, setStopConfirm] = useState<{ ids: SessionId[]; activity?: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [olderThan, setOlderThan] = useState<OlderThan>(0)
  const [trash, setTrash] = useState<TrashMirror | null>(null)
  const [trashError, setTrashError] = useState<string | null>(null)
  const [trashBusy, setTrashBusy] = useState(false)

  /* ── 「显示已归档」开关 ──
   * 只作用于下方总表：搜索结果**不跟着过滤**——搜到却看不见会被当成"搜索坏了"。
   * 默认显示（与本插件历史行为一致）；选择记进 localStorage，面板重开后仍是上次的取舍。 */
  const [showArchived, setShowArchivedState] = useState(readShowArchived)
  const setShowArchived = (next: boolean) => {
    setShowArchivedState(next)
    try {
      window.localStorage.setItem(SHOW_ARCHIVED_KEY, String(next))
    } catch {
      // 存不下只影响本次显示，不值得打断用户。
    }
  }

  /* ── 正文搜索 ──
   * 与原生侧栏搜索的关系（README 有完整说明）：原生**也能搜正文**，但它把结果截到 20 个会话、
   * 摘要不标关键词、结果不能复制。面板这版补的是这三样，并且就地搜索、不用切到侧栏。 */
  const [query, setQuery] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [hitsHasMore, setHitsHasMore] = useState(false)
  const [searchError, setSearchError] = useState<{ code?: string; message?: string } | null>(null)
  const trimmedQuery = query.trim()

  /* 时间滴答：每 30s 刷新相对时间与"几天前"的判定。 */
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  /* 提示自动消退。 */
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), 4200)
    return () => clearTimeout(timer)
  }, [notice])

  /* 读回收站镜像：进入面板时读一次，之后由「刷新」按钮手动触发。 */
  const loadTrash = async () => {
    try {
    // 候选顺序：已知的"本页签会话"优先，然后按列表顺序补齐。
    // 镜像是全局同一份，任意一个能读通的会话都给出同样的内容。
    const candidates = [
      ...(sessionId === undefined ? [] : [sessionId]),
      ...(listState?.ids ?? []),
    ]
    if (candidates.length === 0) {
      setTrash(null)
      setTrashBusy(false)
      setTrashError(t('trashNoSession'))
      probeTrash({ phase: 'no-candidates', hasSessionId: sessionId !== undefined })
      return
    }
    setTrashBusy(true)
    setTrashError(null)
    // 超时兜底：无论 Remote 出什么状况，标签都不会永远停在"加载中"。
    const raced = await Promise.race([
      readTrashMirror(candidates),
      new Promise<MirrorReadResult>(resolve => setTimeout(
        () => resolve({ ok: false, message: 'timed out after 6000ms' }),
        6000,
      )),
    ])
    setTrashBusy(false)
    probeTrash({
      phase: 'read',
      hasSessionId: sessionId !== undefined,
      candidates: Math.min(candidates.length, 12),
      ok: raced.ok,
      tried: raced.tried,
      code: raced.code,
      message: raced.message,
      bytes: raced.text === undefined ? 0 : raced.text.length,
    })
    if (!raced.ok) {
      setTrash(null)
      setTrashError(raced.message ?? raced.code ?? 'read failed')
      return
    }
    try {
      setTrash(JSON.parse(raced.text ?? '') as TrashMirror)
      setTrashError(null)
    } catch {
      setTrash(null)
      setTrashError('invalid mirror JSON')
    }
    } catch (error) {
      // 最后一道保险：任何同步异常都必须落到一个可见状态，绝不允许停在"加载中"。
      setTrash(null)
      setTrashBusy(false)
      const message = String((error as { message?: string })?.message ?? error)
      setTrashError(message)
      probeTrash({ phase: 'threw', message })
    }
  }
  /**
   * 「刷新」= 重拉会话列表 + 重读回收站镜像。
   *
   * 前者是关键：删除是磁盘操作，宿主不推事件，客户端只在重连时重拉列表，
   * 所以删完后原生侧栏的行会一直留着；`sessions.refresh()` 让它立刻消失。
   */
  const refreshAll = async () => {
    const list = await refreshSessions()
    await loadTrash()
    if (!list.ok) showNotice(t('actionFailedToast', { message: list.message ?? '' }))
    else showNotice(t('listRefreshed'))
  }
  useEffect(() => {
    if (sessionId === undefined && (listState?.ids?.length ?? 0) === 0) return
    void loadTrash()
    // 打开面板时顺手重拉一次列表基线：刚删过的对话不该还挂在侧栏里。
    void refreshSessions()
    // 只在会话目录出现或页签会话变化时自动执行；其余时机靠「刷新」按钮。
  }, [sessionId, listState?.ids?.length])

  /* 正文搜索：250ms 防抖 + 取消上一次请求（与原生侧栏同一节奏）。 */
  useEffect(() => {
    if (trimmedQuery === '') {
      setHits([])
      setHitsHasMore(false)
      setSearchError(null)
      setSearchBusy(false)
      return
    }
    const controller = new AbortController()
    setSearchBusy(true)
    const timer = setTimeout(() => {
      void (async () => {
        const outcome = await searchContent(trimmedQuery, controller.signal)
        if (controller.signal.aborted) return
        setSearchBusy(false)
        if (!outcome.ok) {
          setHits([])
          setHitsHasMore(false)
          setSearchError({ code: outcome.code, message: outcome.message })
          return
        }
        setSearchError(null)
        setHits(outcome.hits)
        setHitsHasMore(outcome.hasMore)
      })()
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmedQuery])

  /** 命中行：宿主只回 `{sessionId, snippet}`，其余用本地会话目录补齐。 */
  const hitRows = useMemo(() => hits.map((hit) => {
    const row = listState?.byId?.[hit.sessionId]
    return {
      id: hit.sessionId,
      title: row === undefined ? hit.sessionId : (row.displayTitle || row.id),
      workspace: workspaceTitleOf(hit.sessionId),
      archived: archivedSet.has(hit.sessionId),
      snippet: hit.snippet,
    }
  }), [hits, listState, archivedSet, workspaceOf])

  const copyHits = async () => {
    const lines = hitRows.map((row) => {
      const head = `- ${row.title}（${row.workspace}${row.archived ? ' · 已归档' : ''}）`
      return row.snippet === undefined ? head : `${head}\n  ${row.snippet}`
    })
    const text = [`搜索「${trimmedQuery}」命中 ${hitRows.length} 个对话：`, ...lines].join('\n')
    const ok = await copyText(text)
    showNotice(ok ? t('copiedHitsHint', { count: hitRows.length }) : t('copyFailed'))
  }

  /* 行汇总：非空白、非 subagent；再套时间筛选与「显示已归档」开关。 */
  const rows = useMemo(() => {
    const byId = listState?.byId ?? {}
    const ids = listState?.ids ?? []
    const out: SessionRow[] = []
    const seen = new Set<SessionId>()
    const add = (row: SessionRow | undefined) => {
      if (!row || seen.has(row.id)) return
      seen.add(row.id)
      out.push(row)
    }
    for (const id of ids) add(byId[id])
    for (const row of Object.values(byId)) add(row)
    const cutoff = olderThan === 0 ? 0 : now - olderThan * 86400000
    return out
      .filter(row => !row.blank && row.origin !== 'subagent')
      .filter(row => showArchived || !archivedSet.has(row.id))
      .filter(row => cutoff === 0 || (row.updatedAt ?? 0) < cutoff)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [listState, olderThan, now, showArchived, archivedSet])

  /* 选择集合随可见行修剪。 */
  useEffect(() => {
    const visible = new Set(rows.map(row => row.id))
    setSelected((prev) => {
      let changed = false
      const next = new Set<SessionId>()
      for (const id of prev) {
        if (visible.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [rows])

  const stats = useMemo(() => {
    const counted = Object.values(listState?.byId ?? {}).filter(row => !row.blank && row.origin !== 'subagent')
    return {
      total: counted.length,
      running: counted.filter(row => statusMap.get(row.id)?.running === true).length,
      archived: counted.filter(row => archivedSet.has(row.id)).length,
    }
  }, [listState, statusMap, archivedSet])

  const showNotice = (text: string) => setNotice(text)

  const toggleCheck = (id: SessionId) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setSelected(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(row => row.id))))
  }

  /* ── 批量归档（客户端能力，直接调） ──
   * 运行中的会话由 Host 以 workspace/session-active 拒绝，收集后转为「停止并归档」确认。 */
  const archiveMany = async (ids: SessionId[], archived: boolean, stopActivity = false) => {
    const active: SessionId[] = []
    const summaries: string[] = []
    let failed = 0
    for (const id of ids) {
      const res = await setArchived(id, archived, stopActivity)
      if (res.ok) continue
      if (!stopActivity && res.code === 'workspace/session-active') {
        active.push(id)
        if (res.activity !== undefined) summaries.push(res.activity)
      } else {
        failed += 1
      }
    }
    if (active.length > 0) {
      const activity = [...new Set(summaries)].join(' · ')
      setStopConfirm(activity === '' ? { ids: active } : { ids: active, activity })
      return
    }
    if (failed > 0) { showNotice(t('batchFailedToast', { count: failed })); return }
    showNotice(archived ? t('archivedToast') : t('unarchivedToast'))
    setSelected(new Set())
  }

  /* ── 删除与恢复：生成精确指令并复制（磁盘操作只有宿主能做） ── */
  const copyDeleteInstruction = async () => {
    const picked = rows.filter(row => selected.has(row.id))
    if (picked.length === 0) return
    const lines = picked.map(row => `- ${row.id}  （${row.displayTitle}）`)
    const text = [
      '请用 conversation_delete 删除下面这些对话（confirm: true，默认进回收站）：',
      ...lines,
      '如果有正在运行的，跳过并告诉我。',
    ].join('\n')
    const ok = await copyText(text)
    showNotice(ok ? t('copiedDeleteHint', { count: picked.length }) : t('copyFailed'))
  }

  const copyRestoreInstruction = async () => {
    const ok = await copyText('请用 conversation_restore 恢复最近删掉的那一批对话。')
    showNotice(ok ? t('copiedRestoreHint') : t('copyFailed'))
  }

  /** 清空回收站：不可恢复，所以指令里写明这一点，并带上当前批次数便于核对。 */
  const copyPurgeInstruction = async () => {
    const batches = trash?.count ?? 0
    const text = [
      `请用 conversation_purge 清空回收站（all: true, confirm: true），当前 ${batches} 批。`,
      '这会永久删除，无法恢复。',
    ].join('\n')
    const ok = await copyText(text)
    showNotice(ok ? t('copiedPurgeHint', { count: batches }) : t('copyFailed'))
  }

  const selectedCount = selected.size
  const allChecked = rows.length > 0 && selectedCount === rows.length

  /* 回收站一览的文案。 */
  const batchLines = (trash?.batches ?? []).slice(0, 3)
  const trashLabel = trashError !== null
    ? t('trashUnavailable', { message: trashError })
    : trash === null
      ? t('loading')
      : (trash.count ?? 0) === 0
        ? t('trashEmpty')
        : t('trashTitle', { count: trash.count ?? 0 })

  return (
    <div className="dshm-root">
      <div className="dshm-toolbar">
        <div className="dshm-toolbar__row">
          <input
            className="dshm-search"
            type="search"
            value={query}
            placeholder={t('searchPlaceholder')}
            title={t('searchHint')}
            onChange={(event) => setQuery(event.target.value)}
          />
          {trimmedQuery !== '' && (
            <button className="dshm-btn dshm-btn--ghost" onClick={() => setQuery('')}>
              {t('searchClear')}
            </button>
          )}
        </div>
        <div className="dshm-toolbar__row">
          <span className="dshm-badge">
            {t('statsLine', { count: stats.total, running: stats.running, archived: stats.archived })}
          </span>
          <select
            className="dshm-select"
            value={String(olderThan)}
            onChange={(event) => setOlderThan(Number(event.target.value) as OlderThan)}
            title={t('timeFilterHint')}
          >
            <option value="0">{t('filterAll')}</option>
            <option value="7">{t('filterOlder7')}</option>
            <option value="30">{t('filterOlder30')}</option>
            <option value="90">{t('filterOlder90')}</option>
          </select>
          {(olderThan !== 0 || !showArchived) && (
            <span className="dshm-badge">{t('filteredCount', { count: rows.length })}</span>
          )}
          <label className="dshm-toggle" title={t('showArchivedHint')}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            {t('showArchived')}
          </label>
          <label className="dshm-toggle">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            {t('selectAll')}
          </label>
        </div>
        {selectedCount > 0 && (
          <div className="dshm-toolbar__row">
            <span className="dshm-badge">{t('selectedCount', { count: selectedCount })}</span>
            <button className="dshm-btn" onClick={() => { void archiveMany([...selected], true) }}>
              {t('archive')}
            </button>
            <button className="dshm-btn" onClick={() => { void archiveMany([...selected], false) }}>
              {t('unarchive')}
            </button>
            <button className="dshm-btn dshm-btn--danger" onClick={() => { void copyDeleteInstruction() }}>
              {t('deleteSelected')}
            </button>
            <button className="dshm-btn dshm-btn--ghost" onClick={() => setSelected(new Set())}>
              {t('clearSelection')}
            </button>
          </div>
        )}
      </div>

      <div className="dshm-list">
        {trimmedQuery !== '' ? (
          /* 搜索结果：就地替换表格（与原生侧栏同一交互），并补上高亮/复制/计数。 */
          searchBusy && hits.length === 0 ? (
            <div className="dshm-empty">{t('loading')}</div>
          ) : searchError !== null ? (
            <div className="dshm-empty">
              {t('searchFailed', { message: searchError.message ?? searchError.code ?? '' })}
              <div className="dshm-hint">{t('searchDisabledHint')}</div>
            </div>
          ) : hitRows.length === 0 ? (
            <div className="dshm-empty">{t('searchNoHits')}</div>
          ) : (
            <>
              <div className="dshm-toolbar__row dshm-toolbar__row--pad">
                <span className="dshm-badge">{t('searchHits', { count: hitRows.length })}</span>
                {hitsHasMore && <span className="dshm-hint dshm-hint--inline">{t('searchMore')}</span>}
                <button className="dshm-btn dshm-btn--ghost" onClick={() => { void copyHits() }}>
                  {t('searchCopy')}
                </button>
              </div>
              <div className="dshm-hint dshm-hint--pad">{t('searchJumpHint')}</div>
              <ul className="dshm-hits">
                {hitRows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="dshm-hit"
                      onClick={() => {
                        const res = openSession(row.id)
                        if (!res.ok) showNotice(t('actionFailedToast', { message: res.message ?? '' }))
                      }}
                    >
                      <span className="dshm-hit__head">
                        <StatusDot status={statusMap.get(row.id)} label={t('statusIdle')} />
                        <span className="dshm-hit__title">{row.title}</span>
                        <span className="dshm-hit__meta">{row.workspace}</span>
                        {row.archived && <span className="dshm-badge dshm-badge--inline">{t('archivedBadge')}</span>}
                      </span>
                      {row.snippet !== undefined && (
                        <span className="dshm-hit__snippet">{highlightSnippet(row.snippet, trimmedQuery)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : rows.length === 0 ? (
          <div className="dshm-empty">{listState?.phase !== 'ready' ? t('loading') : t('empty')}</div>
        ) : (
          <table className="dshm-table">
            <thead>
              <tr>
                <th></th>
                <th></th>
                <th>{t('colTitle')}</th>
                <th>{t('colWorkspace')}</th>
                <th>{t('colUpdated')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = statusMap.get(row.id)
                const archived = archivedSet.has(row.id)
                const statusLabel = t(
                  status?.pendingInteraction
                    ? 'statusPending'
                    : status?.running === true
                      ? 'statusRunning'
                      : status?.completionUnread
                        ? 'statusDone'
                        : 'statusIdle',
                )
                const rowCls = [
                  'dshm-row',
                  selected.has(row.id) ? 'dshm-row--selected' : '',
                  archived ? 'dshm-row--archived' : '',
                ].filter(Boolean).join(' ')
                return (
                  <tr key={row.id} className={rowCls}>
                    <td onClick={() => toggleCheck(row.id)}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleCheck(row.id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    <td title={statusLabel}>
                      <StatusDot status={status} label={statusLabel} />
                    </td>
                    <td>
                      <span
                        className="dshm-title dshm-title--link"
                        title={`${row.displayTitle}\n${row.id}`}
                        onClick={() => {
                          const res = openSession(row.id)
                          if (!res.ok) showNotice(t('actionFailedToast', { message: res.message ?? '' }))
                        }}
                      >
                        {row.displayTitle}
                      </span>
                      {archived ? <span className="dshm-badge dshm-badge--inline">{t('archivedBadge')}</span> : null}
                    </td>
                    <td className="dshm-title" title={workspaceTitleOf(row.id)}>{workspaceTitleOf(row.id)}</td>
                    <td>{relativeTime(row.updatedAt, now, t)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 删除与恢复发生在磁盘上，只有宿主能做；回收站一览来自宿主写在工作区里的镜像。 */}
      <div className="dshm-footer">
        <div className="dshm-hint">{t('hostOnlyHint')}</div>
        <div className="dshm-toolbar__row">
          <span className="dshm-badge" title={trash?.trashRoot ?? ''}>{trashLabel}</span>
          <button className="dshm-btn dshm-btn--ghost" disabled={trashBusy} onClick={() => { void refreshAll() }}>
            {t('refresh')}
          </button>
          <button className="dshm-btn" onClick={() => { void copyRestoreInstruction() }}>
            {t('restore')}
          </button>
          <button
            className="dshm-btn dshm-btn--danger"
            title={t('purgeHint')}
            onClick={() => { void copyPurgeInstruction() }}
          >
            {t('purgeBin')}
          </button>
          <span className="dshm-hint dshm-hint--inline">{t('pasteHint')}</span>
        </div>
        {batchLines.map(entry => (
          <div className="dshm-hint" key={entry.batch}>
            {t('batchLine', { batch: entry.batch, count: entry.entries ?? 0, size: entry.sizeKB ?? 0 })}
          </div>
        ))}
      </div>

      {stopConfirm && (
        <div className="dshm-overlay">
          <div className="dshm-dialog">
            <p className="dshm-dialog__title">{t('stopArchiveTitle')}</p>
            <p className="dshm-dialog__body">{t('stopArchiveBody', { count: stopConfirm.ids.length })}</p>
            {stopConfirm.activity !== undefined && (
              <p className="dshm-dialog__body">{t('runningWork', { activity: stopConfirm.activity })}</p>
            )}
            <div className="dshm-dialog__footer">
              <button className="dshm-btn" onClick={() => setStopConfirm(null)}>{t('cancel')}</button>
              <button
                className="dshm-btn dshm-btn--danger"
                onClick={() => {
                  const ids = stopConfirm.ids
                  setStopConfirm(null)
                  void archiveMany(ids, true, true)
                }}
              >
                {t('stopAndArchive')}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="dshm-toast">{notice}</div>}
    </div>
  )
}
