/**
 * 客户端插件入口——本 bundle 浏览器半的 apply。
 *
 * 接入三处：
 *   1. 右侧 Sidebar 的页签类型 `conversation-manager`（带引导页入口），正文与标题分别
 *      注册到 keyed slot `sidebar.right.pane.tab` / `.title`（key = 定义 id = 包名）；
 *   2. 左侧会话行菜单 `sidebar.workspaces.session.menu.item` 的「在对话管理器中定位」项；
 *   3. 贡献包自己的 locale 命名空间。
 *
 * 约定（对齐仓库内 ui-workspace 的浏览器半）：
 *   - 服务用 `ctx.get(name) as Face` 取，不依赖 Context 声明合并；
 *   - 静态文案（页签 chip、引导页条目）用 `ctx.locale.bind(NS)` 取词，语言切换即时生效；
 *   - 组件拿不到 ctx：数据走标准 props，变更走 inject face；
 *   - 运行时只 import 平台模块（react、ui-primitives），其余依赖全部 import type（转译即擦除）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MenuItemButton, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
// 类型合并：拉入各服务的 Context 声明、SlotMap 的 key 与全局标准 props。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { en, NS, zh } from './locale.ts'
import { installStyles, removeStyles } from './styles.ts'
import { ManagerBody, TRASH_MIRROR_PATH, type ActionResult, type ManagerFace, type MirrorReadResult } from './manager.tsx'

export const name = 'dsh-conversation-manager'

/**
 * 依赖的浏览器服务。
 *
 * - `sessions`：面板的「刷新」调用 `sessions.refresh()`（重新拉取列表基线，让已从磁盘
 *   删除的行立刻从原生列表消失）。列表与状态本身走标准 props。
 * - `remote` + **`remote.workspaceFiles`**：读会话工作区里的回收站镜像。
 *   命名空间必须单独声明——只写 `remote` 不够，访问 `ctx.remote.workspaceFiles` 会被
 *   Cordis 以 "cannot get property without inject" 拒绝（实测踩过这个坑）。
 *   ui-workspace 的 `'remote.directoryPicker'` 是同一写法。
 * - `uiWorkspace` 故意不在此列：它在 apply 阶段不一定已注册，而调用只发生在用户交互时，
 *   所以那条路径用惰性 `ctx.get` 解析。
 */
export const inject = [
  'slots',
  'locale',
  'remote',
  'remote.workspaceFiles',
  'sessions',
  'workspaces',
  'sidebarRightTabs',
  'sidebarRight',
]

/** 页签类型的实现身份，同时是正文/标题 keyed slot 的 key。 */
const MANAGER_ID = 'dsh-conversation-manager'
/** 页签类型判别式：`openTab('conversation-manager')` 用它点名。 */
const MANAGER_KIND = 'conversation-manager'

/* ── 标题 slot：活的 chip（随界面语言即时切换） ── */
type TitleProps = PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<typeof NS>
function ManagerTitle({ t }: TitleProps) {
  return <>{t('title')}</>
}

/* ── 会话行菜单项：在对话管理器中定位该会话 ── */
type LocateFace = { locateInManager: (sessionId: SessionId) => void }
type LocateProps =
  & PropsRuntime<'sidebar.workspaces.session.menu.item'>
  & PropsLocale<typeof NS>
  & InjectFace<LocateFace>

function LocateRow({ sessionId, useMenuOpenState, locateInManager, t }: LocateProps) {
  // 行菜单只在自己打开时渲染，因此这个 hook 用于主动收起菜单。
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      separatorBefore
      onSelect={() => {
        setMenuOpen(false)
        locateInManager(sessionId)
      }}
    >
      {t('locateInManager')}
    </MenuItemButton>
  )
}

/**
 * 打开（或聚焦）对话管理器页签。
 *
 * `params` 是 JSON 形状的同进程数据，由页面类型自己消费；这里用一个窄适配类型，
 * 不依赖 DSH 各版本的参数声明合并是否覆盖到本类型。
 */
function openManagerTab(ctx: Context, params?: { focusSessionId?: SessionId }): void {
  const controller = ctx.sidebarRight as unknown as {
    openTab(kind: string, options?: { params?: { focusSessionId?: SessionId } }): void
  }
  controller.openTab(MANAGER_KIND, params === undefined ? {} : { params })
}

/* ── 会话顶部动作条按钮：最显眼的入口 ── */
type HeaderFace = { openManager: () => void }
type HeaderActionProps =
  & PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<HeaderFace>

function ManagerHeaderButton({ openManager, t }: HeaderActionProps) {
  // 用宿主 ui-primitives 的 Button，外观与同一条动作条里的其它控件一致。
  return (
    <Button variant="ghost" size="md" onClick={() => openManager()}>
      {t('title')}
    </Button>
  )
}

/**
 * 激活探针：把「浏览器半激活结果」记一行到 localStorage。
 *
 * 为什么需要它：浏览器半运行在渲染进程里，宿主半（包括 conversation_selftest）看不到它，
 * 「页签没出现」就分不清是**注册失败**、**apply 中途抛错**，还是**用户没找到入口**。
 * localStorage 落在磁盘上（Electron 的 userData/Local Storage），可以离线读出来。
 * 只写一个键、只存结果与错误信息，不存任何对话内容。
 */
function recordActivation(entry: Record<string, unknown>): void {
  try {
    const key = 'dsh-conversation-manager/activation'
    const raw = window.localStorage.getItem(key)
    const previous = raw === null ? [] : JSON.parse(raw) as unknown
    // 保留最近几条，好从「进到哪一步」判断是抛错还是卡住。
    const log = (Array.isArray(previous) ? previous : []).slice(-4)
    log.push({ ...entry, at: new Date().toISOString() })
    window.localStorage.setItem(key, JSON.stringify(log))
  } catch {
    // 隐私模式、存储被禁用等情况下静默跳过：探针失败不该影响插件功能。
  }
}

/** 把任意错误折叠成 JSON 结果（客户端不共享错误类身份，只认名字与 rpcError.code）。 */
function fail(error: unknown): ActionResult {
  const failure = error as {
    name?: string
    rpcError?: { code?: string; message?: string }
    code?: string
    message?: string
  }
  const code = failure?.rpcError?.code ?? failure?.code
  const message = failure?.rpcError?.message ?? failure?.message ?? String(error)
  return { ok: false, ...(code === undefined ? {} : { code }), message }
}

/**
 * 真正干活的 apply 体。外层 `apply` 只负责包一层探针：
 * 浏览器半跑在渲染进程里，宿主侧看不到它的状态，出错时也没有日志可读，
 * 所以「注册了什么 / 在哪一步炸了」必须由它自己写进 localStorage。
 */
function applyInner(ctx: Context): void {
  // 静态文案：与内置页签类型同一取词方式，thunk 每次使用都重读，因此语言切换无需重新注册。
  const t = ctx.locale.bind(NS)
  // 只依赖 workspaces（批量归档）与 sessions（面板的一键刷新）。
  // 会话列表/状态走标准 props，不需要在渲染路径上碰服务。
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  /** 惰性解析：交互发生时该服务必已就绪。 */
  const uiWorkspace = (): UiWorkspace | undefined => ctx.get('uiWorkspace') as UiWorkspace | undefined

  // 生命周期：样式标签随插件加载挂载、卸载移除。
  ctx.effect(() => {
    installStyles()
    return () => removeStyles()
  }, 'dsh-conversation-manager: styles')

  // 生命周期：locale 字典。
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-conversation-manager: dictionaries')

  // 页签类型。无 patterns → 页面类型，经 openTab(kind) 打开，不认领任何资源地址。
  //
  // 注意调用位置：register() 会在注册表所在 fiber 上挂一个 effect。注册表源码明确警告，
  // 若在「另一个插件的 apply 且自己的 effect 仍是活动作用域」时注册，浏览器启动会静默卡死。
  // 官方实现（ui-sidebar-right 自带 guide 类型）的做法就是在 apply 顶层调用，
  // 再把 disposer 交给一个清理 effect —— 这里照做。
  const disposeTabType = ctx.sidebarRightTabs.register({
    id: MANAGER_ID,
    kind: MANAGER_KIND,
    priority: 'extension',
    title: () => t('title'),
    guide: [
      {
        id: 'conversation-manager',
        order: 60,
        title: () => t('guideTitle'),
        description: () => t('guideDescription'),
      },
    ],
  })
  ctx.effect(() => () => { void disposeTabType() }, 'dsh-conversation-manager: tab type')

  // inject face：只投影原生没有的两件能力（打开、归档）。
  // 改名/置顶/分叉/内容搜索/新建会话已从面板移除——它们与原生侧栏重复，做了也没意义。
  const face: ManagerFace = {
    openSession(id: SessionId): ActionResult {
      const service = uiWorkspace()
      if (service === undefined) return { ok: false, message: 'uiWorkspace service is unavailable' }
      try {
        service.openSession(id)
        return { ok: true }
      } catch (error) {
        return fail(error)
      }
    },
    async setArchived(id: SessionId, archived: boolean, stopActivity = false): Promise<ActionResult> {
      try {
        if (archived) {
          await workspaces.archiveSession(id, stopActivity ? { stopActivity: true } : {})
        } else {
          await workspaces.unarchiveSession(id)
        }
        return { ok: true }
      } catch (error) {
        return fail(error)
      }
    },
    /**
     * 读会话工作区里的回收站镜像（宿主写的批次概览）。
     *
     * 走 `workspaceFiles` Remote：它的 scope 就是 sessionId（branded string），
     * 路径相对会话工作区根。这里用窄适配类型，避免把内部 Remote 类型引进来。
     */
    /**
     * 重新拉取会话列表基线（`sessions.refresh()`）。
     *
     * 为什么面板需要它：删除是宿主的磁盘操作，宿主不会为此推事件；客户端只在
     * **重连**时重拉列表。所以删完之后原生侧栏里的行仍然在，直到重连或重启。
     * 这一键刷新让"碍眼的那行立刻消失"不必重连。
     */
    async refreshSessions(): Promise<ActionResult> {
      try {
        await sessions.refresh()
        return { ok: true }
      } catch (error) {
        return fail(error)
      }
    },
    /**
     * 读会话工作区里的回收站镜像（宿主写的批次概览）。
     *
     * `workspaceFiles` 的 scope 必须是会话 id。面板能从标准 prop `useSession` 拿到本次
     * 页签所属会话的 id（实测可用：探针记录 hasSessionId: true），传一串候选只是稳健性兜底
     * ——镜像是全局同一份、宿主又把它写进了每个存活会话的工作区，所以任意一个能读通的会话
     * 都给出同样的内容，也不会因为某个会话没有镜像而整体失败。
     *
     * 每次调用都带上 AbortSignal：Remote 签名要求它，缺省有可能让请求悬着不返回。
     *
     * 注意：`ctx.remote.workspaceFiles` 的访问必须在 try 内——只声明 `'remote'` 而未声明
     * `'remote.workspaceFiles'` 时，Cordis 会在这里抛错；一旦抛在 try 外，异常会变成未处理的
     * Promise 拒绝，界面表现为"永远加载中"（踩过这个坑，见 README）。
     */
    async readTrashMirror(ids: readonly SessionId[]) {
      const remote = ctx.remote as unknown as {
        workspaceFiles?: {
          read?: (
            scope: unknown,
            path: string,
            range: unknown,
            signal: AbortSignal,
          ) => Promise<{ ok?: boolean; value?: { text?: string }; error?: { code?: string; message?: string } }>
        }
      }
      const read = remote?.workspaceFiles?.read
      if (typeof read !== 'function') {
        return { ok: false, message: 'workspaceFiles remote is unavailable', tried: 0 }
      }
      // 上限 12 个：一次面板打开最多 12 次小读取，代价可忽略，又能覆盖常见会话数。
      const candidates = [...new Set(ids)].slice(0, 12)
      let last: MirrorReadResult = { ok: false, message: 'no candidate session id', tried: 0 }
      let tried = 0
      for (const id of candidates) {
        tried += 1
        try {
          const result = await read(id as unknown, TRASH_MIRROR_PATH, {}, new AbortController().signal)
          if (result?.ok === true) {
            return { ok: true, text: String(result.value?.text ?? ''), tried }
          }
          last = {
            ok: false,
            code: result?.error?.code,
            message: result?.error?.message ?? 'read failed',
            tried,
          }
        } catch (error) {
          last = { ...fail(error), tried }
        }
      }
      return { ...last, tried }
    },
  }

  // 正文与标题 keyed slot（key = 本实现 id）。slots.inject 自己就是生命周期：
  // 回调在每段声明存续期内运行，owner 折叠时其 effect 随之移除，所以直接在 apply 顶层调用，
  // 不再外包一层 ctx.effect。
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: MANAGER_ID, locale: NS, inject: (): ManagerFace => face },
    ManagerBody,
  ))

  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: MANAGER_ID, locale: NS },
    ManagerTitle,
  ))

  // 对话头部的可见按钮：比藏在右侧栏引导页里容易发现得多。
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'dsh-conversation-manager.open',
      order: 50,
      locale: NS,
      inject: (): HeaderFace => ({ openManager: () => openManagerTab(ctx) }),
    },
    ManagerHeaderButton,
  ))

  // 左侧会话行菜单项。order 500 落在内置 rename(200) / fork(300) / archive(400) 之后。
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces.session.menu.item',
      id: 'dsh-conversation-manager.locate',
      order: 500,
      locale: NS,
      inject: (): LocateFace => ({
        locateInManager: (sessionId: SessionId) => { openManagerTab(ctx, { focusSessionId: sessionId }) },
      }),
    },
    LocateRow,
  ))
}

/**
 * 插件入口：包一层激活探针。失败时先记录再原样抛出，不吞掉框架的报错。
 */
export function apply(ctx: Context): void {
  // 先记一条「进入」：若只看到这条，说明 apply 卡住没返回（框架里有静默 stall 的先例）。
  recordActivation({ phase: 'enter' })
  try {
    applyInner(ctx)
    recordActivation({
      phase: 'done',
      ok: true,
      kind: MANAGER_KIND,
      id: MANAGER_ID,
      slots: [
        'conversation.session.header.actions',
        'sidebar.right.pane.tab',
        'sidebar.right.pane.tab.title',
        'sidebar.workspaces.session.menu.item',
      ],
      locale: NS,
    })
  } catch (error) {
    const info = error as { message?: string; stack?: string }
    recordActivation({
      phase: 'error',
      ok: false,
      message: info?.message ?? String(error),
      stack: typeof info?.stack === 'string' ? info.stack.slice(0, 2000) : undefined,
      locale: NS,
    })
    throw error
  }
}