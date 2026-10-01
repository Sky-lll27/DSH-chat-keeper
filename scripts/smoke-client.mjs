#!/usr/bin/env node
/**
 * 客户端 bundle 冒烟测试——不需要 DSH，也不需要浏览器，只要 node。
 *
 * 它用最小的桩把产物真实跑一遍：
 *   window.__ModuleLoader__.load  ← 捕获工厂注册
 *   require                       ← 三个平台模块的最小实现
 *   ctx                           ← 记录 register/effect/inject 调用的假上下文
 *
 * 验证四件事：
 *   1. bundle 恰好注册一次工厂，且 id 正确；
 *   2. 工厂执行后导出插件契约 { name, inject, apply }；
 *   3. apply(ctx) 不抛错；
 *   4. apply 真的注册了：页签类型（含 guide 条目）、正文/标题 keyed slot、
 *      左侧会话行菜单项、locale 中英字典、样式 effect。
 *
 * 用法：node scripts/smoke-client.mjs [产物路径]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const target = process.argv[2] ?? resolve(here, '..', 'dist', 'client.js')

const checks = []
const failures = []
function check(label, condition, detail = '') {
  checks.push({ label, ok: Boolean(condition), detail })
  if (!condition) failures.push(`${label}${detail === '' ? '' : ` — ${detail}`}`)
}

// ── 1. 捕获工厂注册 ──────────────────────────────────────────────────────────
const registrations = []
// localStorage 桩：插件用它写激活探针，这里顺便断言探针真的写了。
const storage = new Map()
const localStorageStub = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)) },
  removeItem: key => { storage.delete(key) },
}
const sandbox = {
  window: { __ModuleLoader__: { load: entry => registrations.push(entry) }, localStorage: localStorageStub },
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  AbortController,
}
vm.createContext(sandbox)
try {
  vm.runInContext(readFileSync(target, 'utf8'), sandbox, { filename: target })
} catch (error) {
  console.error(`产物在顶层求值时抛错：${String(error)}`)
  process.exit(1)
}

check('注册了恰好一次工厂', registrations.length === 1, `实际 ${registrations.length} 次`)
const entry = registrations[0]
check('工厂 id 为 dsh-conversation-manager', entry?.id === 'dsh-conversation-manager', `实际 ${String(entry?.id)}`)
check('工厂是函数', typeof entry?.factory === 'function')

// ── 2. 执行工厂：平台模块用最小桩 ────────────────────────────────────────────
const reactStub = {
  createElement: () => ({}),
  Fragment: Symbol('Fragment'),
  useState: value => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useMemo: factory => factory(),
  useRef: value => ({ current: value }),
}
const jsxRuntimeStub = { jsx: () => ({}), jsxs: () => ({}), Fragment: Symbol('Fragment') }
const primitivesStub = { MenuItemButton: () => ({}) }
const moduleTable = {
  'react': reactStub,
  'react/jsx-runtime': jsxRuntimeStub,
  '@deepseek-ai/dsh-client-ui-primitives': primitivesStub,
}
const requested = []
const requireStub = specifier => {
  requested.push(specifier)
  if (!(specifier in moduleTable)) throw new Error(`模块表没有 ${specifier}`)
  return moduleTable[specifier]
}

let plugin
try {
  plugin = entry.factory(requireStub)
} catch (error) {
  console.error(`工厂执行时抛错：${String(error)}`)
  process.exit(1)
}

check('导出 name', plugin?.name === 'dsh-conversation-manager', `实际 ${String(plugin?.name)}`)
check('导出 apply 函数', typeof plugin?.apply === 'function')
check('导出 inject 数组', Array.isArray(plugin?.inject))
for (const service of ['slots', 'locale', 'remote', 'remote.workspaceFiles', 'sessions', 'workspaces', 'sidebarRightTabs', 'sidebarRight']) {
  check(`inject 声明了 ${service}`, plugin?.inject?.includes(service))
}
check('没有请求平台模块表之外的依赖', requested.every(s => s in moduleTable), requested.join(', '))

// ── 3. 假 ctx：记录 apply 的每一次注册 ───────────────────────────────────────
const recorded = { tabs: [], slots: [], locales: [], effects: [], tabOpens: [] }
const sessionsStub = {
  list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }) },
  refresh: async () => {},
  search: async () => ({ ok: true, value: { items: [], hasMore: false } }),
  fork: async () => 'child',
  using: async (target, options, operation) => operation({
    sessionId: target,
    binding: { session: { rename: async title => ({ ok: true, value: { title } }) } },
  }),
}
const workspacesStub = {
  list: { getSnapshot: () => ({ items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }) },
  initializeDefault: async () => undefined,
  pinSession: async () => {},
  unpinSession: async () => {},
  archiveSession: async () => {},
  unarchiveSession: async () => {},
}
const uiWorkspaceStub = { openSession: () => {}, startSession: () => {}, openWorkspace: async () => {}, forkSession: async () => 'x' }

const ctx = {
  effect: (fn, label) => { recorded.effects.push(label); const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
  get: name => ({ sessions: sessionsStub, workspaces: workspacesStub, uiWorkspace: uiWorkspaceStub })[name],
  locale: {
    bind: ns => (key, params) => (params === undefined ? `${ns}.${key}` : `${ns}.${key}(${JSON.stringify(params)})`),
    register: (ns, dicts) => { recorded.locales.push({ ns, dicts }); return () => {} },
  },
  sidebarRightTabs: { register: definition => { recorded.tabs.push(definition); return () => {} } },
  sidebarRight: { openTab: (kind, options) => { recorded.tabOpens.push({ kind, options }) } },
  slots: {
    inject: (name, callback) => { callback(); return () => {} },
    register: (registration, component) => { recorded.slots.push({ registration, component }); return () => {} },
  },
}

try {
  plugin.apply(ctx)
} catch (error) {
  console.error(`apply(ctx) 抛错：${String(error)}\n${String(error?.stack ?? '')}`)
  process.exit(1)
}
check('apply(ctx) 未抛错', true)

// ── 4. 注册内容断言 ─────────────────────────────────────────────────────────
const tab = recorded.tabs[0]
check('注册了一个页签类型', recorded.tabs.length === 1)
check('页签 id 正确', tab?.id === 'dsh-conversation-manager', String(tab?.id))
check('页签 kind 正确', tab?.kind === 'conversation-manager', String(tab?.kind))
check('页签 priority 为 extension', tab?.priority === 'extension', String(tab?.priority))
check('title 是 thunk 且返回字符串', typeof tab?.title === 'function' && typeof tab.title('x') === 'string')
check('guide 是数组且有一条', Array.isArray(tab?.guide) && tab.guide.length === 1)
const guide = tab?.guide?.[0]
check('guide 条目有 id 与数字 order', typeof guide?.id === 'string' && typeof guide?.order === 'number')
check('guide title/description 是 thunk', typeof guide?.title === 'function' && typeof guide?.description === 'function')

const slotNames = recorded.slots.map(s => s.registration.name)
check('注册了正文 keyed slot', slotNames.includes('sidebar.right.pane.tab'))
check('注册了标题 keyed slot', slotNames.includes('sidebar.right.pane.tab.title'))
check('注册了会话行菜单项', slotNames.includes('sidebar.workspaces.session.menu.item'))
check('注册了会话头部按钮', slotNames.includes('conversation.session.header.actions'))
const bodySlot = recorded.slots.find(s => s.registration.name === 'sidebar.right.pane.tab')
check('正文 slot 的 key 等于页签 id', bodySlot?.registration.key === 'dsh-conversation-manager', String(bodySlot?.registration.key))
check('正文 slot 声明了 locale', bodySlot?.registration.locale === 'dsh-conversation-manager')
check('正文组件是函数', typeof bodySlot?.component === 'function')
const menuSlot = recorded.slots.find(s => s.registration.name === 'sidebar.workspaces.session.menu.item')
check('菜单项有 id 与数字 order', typeof menuSlot?.registration.id === 'string' && typeof menuSlot?.registration.order === 'number')

check('注册了 locale 字典', recorded.locales.length === 1)
const dicts = recorded.locales[0]?.dicts
check('字典同时含 en 与 zh', dicts !== undefined && dicts.en !== undefined && dicts.zh !== undefined)
check('en 与 zh 键集合一致', dicts !== undefined
  && JSON.stringify(Object.keys(dicts.en).sort()) === JSON.stringify(Object.keys(dicts.zh).sort()))
check('注册了样式 effect', recorded.effects.some(label => String(label).includes('styles')))

// ── 5. 激活探针 ─────────────────────────────────────────────────────────────
const probeRaw = storage.get('dsh-conversation-manager/activation')
check('激活探针写入了 localStorage', typeof probeRaw === 'string', String(probeRaw))
if (typeof probeRaw === 'string') {
  let log
  try { log = JSON.parse(probeRaw) } catch { log = undefined }
  check('探针记录的是数组', Array.isArray(log), JSON.stringify(log))
  check('记录了两条：enter + done', Array.isArray(log) && log.length === 2, JSON.stringify(log))
  check('第一条是 enter', log?.[0]?.phase === 'enter')
  check('第二条是 done 且 ok', log?.[1]?.phase === 'done' && log[1]?.ok === true, JSON.stringify(log?.[1]))
  check('done 记录了注册的 slot 名', Array.isArray(log?.[1]?.slots) && log[1].slots.includes('sidebar.right.pane.tab'))
  check('每条都有时间戳', log?.every(entry => typeof entry?.at === 'string'))
}

// ── 报告 ────────────────────────────────────────────────────────────────────
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.label}${item.ok ? '' : ` — ${item.detail}`}`)
console.log(`\n${checks.length - failures.length}/${checks.length} 项通过`)
if (failures.length > 0) {
  console.error('\n失败项：')
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log('通过：产物可加载，插件契约与注册内容符合预期。')
