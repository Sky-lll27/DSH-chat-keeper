/**
 * 冒烟测试：用一个最小伪造的 Cordis 上下文驱动插件，验证
 *   1. 插件契约（name / inject / apply）
 *   2. 生命周期事件 → 对话索引
 *   3. 七个工具的实际行为
 *   4. 可选的索引持久化
 *
 * 运行：node test/smoke.mjs
 * 它不需要 DSH，也不需要任何依赖，因此可以在容器/CI 里先跑通逻辑，
 * 再去宿主机上用 --patch 验证真实挂载。
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply, inject, name } from '../index.js'
import { resolveDshHome } from '../lib/cleanup.js'
import { MIRROR_RELATIVE_PATH } from '../lib/trash-mirror.js'

/** 包根目录（本文件在 <root>/test/ 下）。 */
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))

let passed = 0
/** 同步检查；传入 async 回调会立刻报错，避免假通过。 */
function check(label, fn) {
  const result = fn()
  if (result && typeof result.then === 'function') {
    throw new Error(`check("${label}") 收到 Promise，请改用 checkAsync`)
  }
  passed += 1
  console.log(`  ok  ${label}`)
}

/** 异步检查。 */
async function checkAsync(label, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

/** 伪造一个够用的 Cordis ctx。 */
function createFakeCtx(options = {}) {
  const handlers = new Map()
  const services = new Map()
  const tools = new Map()
  const disposers = []
  const emitted = []
  const sessions = new Map()
  const warnings = []

  const ctx = {
    logger: {
      info: () => {},
      warn: (message) => warnings.push(message),
    },
    sessions: {
      // 故意提供一个「返回 Promise」的开关：用来回归 index.js 里
      // 「list() 非数组时 for...of 抛错 → 整个插件加载失败」这条硬故障路径。
      list: () => (options.listReturnsPromise ? Promise.resolve([...sessions.values()]) : [...sessions.values()]),
      get: (id) => sessions.get(id),
      fork: (source, boundary) => {
        const child = makeSession(`${source.id}-fork`, [])
        sessions.set(child.id, child)
        return child
      },
    },
    agents: { get: () => undefined, list: () => [] },
    tools: {
      register: (definition) => {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    on: (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
      return () => {}
    },
    effect: (fn) => {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => {}
    },
    get: (key) => services.get(key),
    set: (key, value) => void services.set(key, value),
    provide: (key, value) => void services.set(key, value),
    emit: (event, payload) => void emitted.push({ event, payload }),
  }

  return {
    ctx,
    tools,
    services,
    emitted,
    sessions,
    warnings,
    disposeAll: () => {
      for (const disposer of disposers.reverse()) disposer()
    },
    fire: (event, ...args) => {
      for (const handler of handlers.get(event) ?? []) handler(...args)
    },
  }
}

/**
 * 伪造一个会话。
 *
 * 形状严格对齐本机 app.asar 里实际的 `Session` 声明：
 *   - `get seq()` 是日志长度（非弃用）
 *   - `deriveMessages(): Message[]` 是模型可见历史（非弃用）
 *   - `snapshotEvents()` 已弃用 —— 这里统计它的调用次数，用来断言默认路径不碰它
 *   - assistant 消息的内容里携带 `tool-call` 块（真实组装结果就是这样）
 */
function makeSession(id, events, options = {}) {
  const session = {
    id,
    // 工作区指到系统临时目录：宿主会往「存活会话的工作区」写回收站镜像，
    // 若这里用真实路径，跑一次测试就会污染真实工作区（曾经踩过）。
    header: { cwd: options.cwd ?? join(tmpdir(), 'dsh-ws-fixture') },
    snapshotCalls: 0,
    get seq() {
      return events.length
    },
    snapshotEvents() {
      session.snapshotCalls += 1
      return events
    },
  }
  if (!options.noDeriveMessages) {
    session.deriveMessages = () => {
      const messages = []
      for (const event of events) {
        if (event.type === 'user/message') {
          messages.push({ role: 'user', id: `m${event.seq}`, content: event.data?.content ?? [] })
        } else if (event.type === 'assistant/message') {
          messages.push({ role: 'assistant', id: `m${event.seq}`, content: [...(event.data?.message?.content ?? [])] })
        } else if (event.type === 'tool/call') {
          // 真实的循环会把工具调用组装进 assistant 消息的内容块里。
          const last = messages[messages.length - 1]
          if (last && last.role === 'assistant') {
            last.content = [
              ...last.content,
              { type: 'tool-call', id: event.data?.callId, name: event.data?.name, arguments: event.data?.arguments },
            ]
          }
        } else if (event.type === 'tool/result') {
          messages.push({
            role: 'tool',
            toolCallId: event.data?.message?.toolCallId,
            content: event.data?.message?.content ?? [],
            isError: event.data?.message?.isError === true,
          })
        }
      }
      return messages
    }
  }
  return session
}

/** 往会话里追加一条事件，并像宿主那样广播 session/event。 */
function pushEvent(harness, session, events, event) {
  const full = { seq: events.length, time: Date.now(), ...event }
  events.push(full)
  harness.fire('session/event', session, full)
  return full
}

console.log('\nDSH 对话管理器 · 冒烟测试\n')

// ── 1. 插件契约 ─────────────────────────────────────────────────────────────
console.log('插件契约')
const harness = createFakeCtx()
check('name 是稳定标识', () => assert.equal(name, 'conversation-manager'))
check('inject 声明 tools/sessions/agents', () =>
  assert.deepEqual([...inject].sort(), ['agents', 'sessions', 'tools']),
)
apply(harness.ctx, {})
check('暴露 conversationManager 服务', () => {
  const service = harness.services.get('conversationManager')
  assert.ok(service, 'ctx.provide 应写入服务表')
  assert.equal(typeof service.list, 'function')
  assert.equal(typeof service.stats, 'function')
})

// 回归：这是唯一能造成「插件根本加载不了」的路径（apply 顶层的 for...of）。
const hostile = createFakeCtx({ listReturnsPromise: true })
check('sessions.list() 返回 Promise 时插件仍能加载', () => {
  apply(hostile.ctx, {})
  assert.ok(hostile.tools.has('conversation_list'), '工具应当照常注册')
  const notes = hostile.services.get('conversationManager').diagnostics().notes
  assert.ok(
    notes.some((note) => note.includes('list()')),
    `应当记下 list() 未返回数组，实际 notes=${JSON.stringify(notes)}`,
  )
  hostile.disposeAll()
})

const expectedTools = [
  'conversation_list',
  'conversation_get',
  'conversation_history',
  'conversation_search',
  'conversation_stats',
  'conversation_label',
  'conversation_fork',
  'conversation_selftest',
  'conversation_list_all',
  'conversation_delete',
  'conversation_restore',
]
check('十一个工具全部注册', () => {
  for (const toolName of expectedTools) assert.ok(harness.tools.has(toolName), `缺少 ${toolName}`)
})
// 两半各自打包、无法共享模块，镜像路径在两处各写一份；这里用产物做交叉验证，
// 免得改了宿主常量却忘了客户端（面板会静默读不到回收站）。
check('回收站镜像路径在两半之间一致', () => {
  const bundlePath = join(rootDir, 'dist', 'client.js')
  assert.ok(existsSync(bundlePath), `客户端产物不存在：${bundlePath}（先跑 pnpm run bundle）`)
  const bundle = readFileSync(bundlePath, 'utf8')
  assert.ok(
    bundle.includes(MIRROR_RELATIVE_PATH),
    `客户端产物里没有宿主声明的镜像路径 ${MIRROR_RELATIVE_PATH}`,
  )
})
check('每个工具的 output 声明合法', () => {
  for (const definition of harness.tools.values()) {
    assert.ok(definition.output && definition.output.schema, `${definition.name} 缺少 output.schema`)
    assert.equal(typeof definition.output.render, 'function', `${definition.name} 缺少 render`)
    assert.equal(typeof definition.execute, 'function', `${definition.name} 缺少 execute`)
    assert.equal(definition.parameters.type, 'object', `${definition.name} 参数根必须是 object`)
  }
})

// ── 2. 生命周期 → 索引 ──────────────────────────────────────────────────────
console.log('\n生命周期追踪')
const events = []
const session = makeSession('session-1', events)
harness.sessions.set(session.id, session)
harness.fire('session/created', session)

check('会话创建即登记', () => {
  const rows = harness.services.get('conversationManager').list()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'session-1')
  assert.equal(rows[0].title, '(untitled)')
})

pushEvent(harness, session, events, {
  type: 'user/message',
  data: { content: [{ type: 'text', text: '帮我看看 DSH 插件怎么写' }] },
})
pushEvent(harness, session, events, {
  type: 'assistant/message',
  data: {
    message: {
      role: 'assistant',
      // 按官方 ContentBlockMap 的标签混合：reasoning（内容在 thinking 字段）、
      // text、file。用于回归「推理不进摘要、附件有标记」。
      content: [
        { type: 'reasoning', thinking: '这段内部推理不应出现在摘要里' },
        { type: 'text', text: '插件就是一个导出 apply 的模块' },
        { type: 'file', ref: 'file-1' },
      ],
    },
    usage: { inputTokens: 100, outputTokens: 20 },
  },
})
pushEvent(harness, session, events, {
  type: 'tool/call',
  data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{"path":"index.js"}' },
})
harness.fire('agent/status', { agent: { id: 'session-1' }, status: 'running' })

check('首条用户消息成为标题', () => {
  const row = harness.services.get('conversationManager').list()[0]
  assert.match(row.title, /DSH 插件怎么写/)
})
check('计数与用量被累计', () => {
  const row = harness.services.get('conversationManager').list()[0]
  assert.equal(row.userMessages, 1)
  assert.equal(row.assistantMessages, 1)
  assert.equal(row.toolCalls, 1)
  assert.equal(row.running, true)
  assert.equal(row.usage.inputTokens, 100)
  assert.equal(row.usage.outputTokens, 20)
})

// ── 3. 工具行为 ─────────────────────────────────────────────────────────────
console.log('\n工具行为')
const run = (toolName, args = {}) => harness.tools.get(toolName).execute(args, { signal: new AbortController().signal })

const listResult = await run('conversation_list', { limit: 5 })
check('conversation_list 返回会话行', () => {
  assert.equal(listResult.returned, 1)
  assert.equal(listResult.conversations[0].id, 'session-1')
})

const getResult = await run('conversation_get', { conversation_id: 'session-1', recent_messages: 5 })
check('conversation_get 汇总计数与最近消息', () => {
  assert.equal(getResult.available, true)
  assert.equal(getResult.counts.events, 3)
  assert.equal(getResult.counts.userMessages, 1)
  assert.equal(getResult.messages.length, 2)
  assert.equal(getResult.historySource, 'deriveMessages')
  assert.equal(getResult.deprecatedReaderUsed, false)
})

const history = await run('conversation_history', { conversation_id: 'session-1', limit: 10 })
check('conversation_history 投影 user/assistant', () => {
  assert.equal(history.available, true)
  assert.deepEqual(
    history.messages.map((message) => message.role),
    ['user', 'assistant'],
  )
  assert.match(history.messages[0].text, /DSH 插件怎么写/)
  assert.equal(history.historySource, 'deriveMessages')
})

check('默认路径完全不触碰已弃用的 snapshotEvents()', () => {
  assert.equal(session.snapshotCalls, 0, `期望 0 次，实际 ${session.snapshotCalls} 次`)
})

const withTools = await run('conversation_history', {
  conversation_id: 'session-1',
  limit: 10,
  include_tools: true,
})
check('include_tools 时带上工具调用', () => {
  // 真实形状：工具调用是 assistant 消息内容里的 tool-call 块，被展开成 toolCalls。
  assert.ok(
    withTools.messages.some((message) => (message.toolCalls ?? []).some((call) => call.name === 'read')),
    `期望 assistant 条目带 toolCalls，实际 ${JSON.stringify(withTools.messages)}`,
  )
})

check('reasoning 块不进摘要、file 块被标记（依据 ContentBlockMap 标签）', () => {
  const assistant = history.messages.find((message) => message.role === 'assistant')
  assert.ok(assistant, '应当有 assistant 消息')
  assert.doesNotMatch(assistant.text, /内部推理/)
  assert.match(assistant.text, /导出 apply 的模块/)
  assert.match(assistant.text, /\[file\]/)
})

const search = await run('conversation_search', { query: '插件' })
check('conversation_search 命中正文并给出摘录', () => {
  assert.equal(search.length, 1)
  assert.ok(search[0].matches.length >= 1)
})

const miss = await run('conversation_search', { query: '绝对不存在的关键字zzz' })
check('搜索无结果时返回空数组', () => assert.deepEqual(miss, []))

const stats = await run('conversation_stats')
check('conversation_stats 汇总正确', () => {
  assert.equal(stats.conversations, 1)
  assert.equal(stats.running, 1)
  assert.equal(stats.toolCalls, 1)
  assert.equal(stats.usage.inputTokens, 100)
  // 依据 TokenUsage 文档：计费输入 = 未缓存输入 + 缓存读 + 缓存写。
  assert.equal(stats.billableInputTokens, 100)
})

const label = await run('conversation_label', { conversation_id: 'session-1', title: '插件开发讨论' })
check('conversation_label 更新管理器标题并如实报告持久化结果', () => {
  assert.equal(label.managerTitleUpdated, true)
  assert.equal(label.durable, false)
  assert.equal(harness.services.get('conversationManager').list()[0].title, '插件开发讨论')
})

const fork = await run('conversation_fork', { conversation_id: 'session-1' })
check('conversation_fork 派生新会话并登记', () => {
  assert.equal(fork.forked, true)
  assert.equal(fork.forkedConversationId, 'session-1-fork')
  assert.equal(harness.services.get('conversationManager').list().length, 2)
})

const selftest = await run('conversation_selftest')
check('conversation_selftest 与真实宿主形态对账', () => {
  assert.equal(selftest.plugin.name, 'conversation-manager')
  assert.equal(selftest.plugin.registeredTools.length, 11)
  assert.equal(selftest.services.managerExposedVia, 'provide')
  assert.equal(selftest.services.sessionsFork, 'function')
  assert.equal(selftest.tracking.handlersFired['session/event'], 3)
  assert.ok(selftest.tracking.distinctEventTypes.includes('user/message'))
  assert.ok(
    selftest.liveSessionSamples.some(
      (probe) => probe.id === 'session-1' && probe.hasSnapshotEvents === true && probe.snapshotReturns === 'array',
    ),
  )
  assert.deepEqual(selftest.services.sessionControllerMethods, [])
  assert.ok(Array.isArray(selftest.findings) && selftest.findings.length > 0)
})

const diagnostics = harness.services.get('conversationManager').diagnostics()
check('diagnostics() 暴露可序列化的账本', () => {
  assert.equal(diagnostics.providedVia, 'provide')
  assert.equal(diagnostics.handlersFired['session/event'], 3)
  assert.ok(diagnostics.distinctEventTypes.includes('tool/call'))
  assert.equal(JSON.parse(JSON.stringify(diagnostics)).tracked, 2)
})

await checkAsync('未知会话 id 会给出明确错误', async () => {
  await assert.rejects(() => run('conversation_get', { conversation_id: 'nope' }), /Unknown conversation/)
})
await checkAsync('缺少必填参数会报错', async () => {
  await assert.rejects(() => run('conversation_history', {}), /conversation_id is required/)
})

await checkAsync('会话销毁后索引保留、历史不可读', async () => {
  harness.fire('session/disposed', session)
  const row = harness.services.get('conversationManager').list().find((entry) => entry.id === 'session-1')
  assert.equal(row.live, false)
  const after = await run('conversation_history', { conversation_id: 'session-1' })
  assert.equal(after.available, false)
  assert.deepEqual(after.messages, [])
})

check('状态变化事件被广播', () =>
  assert.ok(harness.emitted.some((entry) => entry.event === 'conversation-manager/changed')),
)

// ── 4. 可选持久化 ───────────────────────────────────────────────────────────
console.log('\n索引持久化')
const dir = mkdtempSync(join(tmpdir(), 'dsh-conv-'))
const persistPath = join(dir, 'index.json')
try {
  const second = createFakeCtx()
  apply(second.ctx, { persistPath, saveDebounceMs: 100000 })
  const events2 = []
  const session2 = makeSession('session-persist', events2)
  second.sessions.set(session2.id, session2)
  second.fire('session/created', session2)
  pushEvent(second, session2, events2, {
    type: 'user/message',
    data: { content: [{ type: 'text', text: '记得把我写进磁盘' }] },
  })
  second.disposeAll()
  check('卸载时落盘', () => {
    const snapshot = JSON.parse(readFileSync(persistPath, 'utf8'))
    assert.equal(snapshot.records.length, 1)
    assert.equal(snapshot.records[0].id, 'session-persist')
    assert.match(snapshot.records[0].title, /记得把我写进磁盘/)
  })

  // 真正的恢复路径：换一个全新 harness 用同一个文件启动。
  const third = createFakeCtx()
  apply(third.ctx, { persistPath, saveDebounceMs: 100000 })
  check('重启后能恢复元数据（且存活状态被重置）', () => {
    const rows = third.services.get('conversationManager').list()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, 'session-persist')
    assert.match(rows[0].title, /记得把我写进磁盘/)
    assert.equal(rows[0].live, false)
    assert.equal(rows[0].running, false)
  })

  // 恢复后的记录再次见到存活会话时，应当补一次全量统计而不是继续增量。
  const events3 = [
    { seq: 0, time: Date.now(), type: 'user/message', data: { content: [{ type: 'text', text: '记得把我写进磁盘' }] } },
    {
      seq: 1,
      time: Date.now(),
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '好' }] }, usage: { outputTokens: 5 } },
    },
  ]
  const session3 = makeSession('session-persist', events3)
  third.sessions.set(session3.id, session3)
  third.fire('session/created', session3)
  check('恢复后的记录重见存活会话时按默认路径补齐计数', () => {
    const row = third.services
      .get('conversationManager')
      .list()
      .find((entry) => entry.id === 'session-persist')
    assert.equal(row.live, true)
    assert.equal(row.userMessages, 1)
    assert.equal(row.assistantMessages, 1)
    // 默认不 deepScan：轮次与 usage 只存在于事件日志里，必须显式开启才读得到。
    // 因此这里断言它们保持未采集——这与上面「默认路径完全不触碰 snapshotEvents()」
    // 是同一条设计约束的两面。
    assert.equal(row.usage.outputTokens, undefined)
    assert.equal(session3.snapshotCalls, 0)
  })
  third.disposeAll()

  // 显式开启 deepScan 时，同一条冷记录重见存活会话应当补出 usage
  // （代价是调用已弃用的 snapshotEvents()，所以它是可选开关而非默认行为）。
  const fourth = createFakeCtx()
  apply(fourth.ctx, { persistPath, deepScan: true, saveDebounceMs: 100000 })
  const session4 = makeSession('session-persist', events3)
  fourth.sessions.set(session4.id, session4)
  fourth.fire('session/created', session4)
  check('deepScan 开启后能补出 usage（并确实调用了弃用读法）', () => {
    const row = fourth.services
      .get('conversationManager')
      .list()
      .find((entry) => entry.id === 'session-persist')
    assert.equal(row.usage.outputTokens, 5)
    assert.ok(session4.snapshotCalls > 0, 'deepScan 应当调用 snapshotEvents()')
  })
  fourth.disposeAll()
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ── 5. $DSH_HOME 解析（回归：应用主进程里没有该环境变量） ─────────────────────
console.log('\n$DSH_HOME 解析')
check('不像 DSH home 的目录不会被采纳', () => {
  const empty = mkdtempSync(join(tmpdir(), 'dsh-empty-'))
  const saved = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    assert.notEqual(resolveDshHome(empty).home, empty, '缺少 sessions/storages/profiles 的目录不该被当作 home')
    // 候选被拒时也必须如实报出"试过哪些"，否则用户无从下手。
    assert.ok(resolveDshHome(empty).tried.includes(empty))
  } finally {
    if (saved !== undefined) process.env.DSH_HOME = saved
    rmSync(empty, { recursive: true, force: true })
  }
})
check('像 DSH home 的目录会被采纳，且注入值优先于环境变量', () => {
  const real = mkdtempSync(join(tmpdir(), 'dsh-real-'))
  const other = mkdtempSync(join(tmpdir(), 'dsh-other-'))
  mkdirSync(join(real, 'sessions'), { recursive: true })
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = other
  try {
    assert.equal(resolveDshHome(real).home, real, '注入的合法 home 应优先')
    assert.notEqual(resolveDshHome(undefined).home, other, '环境变量指向不存在的 home 时不该采纳')
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    rmSync(real, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  }
})

// ── 6. 磁盘清理：列出 / 删除（回收站）/ 恢复 ─────────────────────────────────
// 注意：清理工具按 $DSH_HOME 定位真实数据，所以这里必须在「把 DSH_HOME 指向夹具」
// 之后再 apply 一个独立 harness —— 否则它会去动真实的 $DSH_HOME。
console.log('\n磁盘清理（删除与恢复）')
const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
const fixture = [
  { id: 'session-1', ws: '--F--', title: '存活会话（不该被删）', first: '我在运行中', size: 128 },
  { id: 'old-a', ws: '--F--', title: '旧对话 A', first: '第一条消息 A', size: 256 },
  { id: 'old-b', ws: '--G--', title: '旧对话 B', first: '第一条消息 B', size: 64 },
]
for (const entry of fixture) {
  const dir = join(home, 'sessions', entry.ws, entry.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'x'.repeat(entry.size))
  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, `${entry.id}.json`), JSON.stringify({
    record: {
      identity: { cwd: entry.ws === '--F--' ? 'F:\\demo' : 'G:\\other', createdAt: Date.now() },
      rows: { title: { val: entry.title }, titleInput: { val: { first: { text: entry.first } } } },
    },
  }))
}
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const cleaner = createFakeCtx()
apply(cleaner.ctx, {})
// 让夹具里的 session-1 在本进程「存活」，用来验证删除会拒绝运行中的对话。
const liveFixture = makeSession('session-1', [{ seq: 0, time: Date.now(), type: 'user/message', data: { content: [{ type: 'text', text: '我在运行中' }] } }])
// 关键：把它的工作区指到临时目录，否则回收站镜像会写进真实的 开发者工作目录。
liveFixture.header.cwd = join(home, 'ws')
cleaner.sessions.set(liveFixture.id, liveFixture)
cleaner.fire('session/created', liveFixture)
const mirrorFile = join(home, 'ws', '.dsh-conversation-manager', 'trash.json')
const runClean = (toolName, args = {}) => cleaner.tools.get(toolName).execute(args, { signal: new AbortController().signal })

const all = await runClean('conversation_list_all', {})
check('conversation_list_all 从磁盘列出全部对话（含标题与路径）', () => {
  assert.equal(all.total, 3, JSON.stringify(all).slice(0, 300))
  assert.deepEqual(all.conversations.map(row => row.id).sort(), ['old-a', 'old-b', 'session-1'])
  const row = all.conversations.find(candidate => candidate.id === 'old-a')
  assert.equal(row.title, '旧对话 A')
  assert.equal(row.workspace, 'F:\\demo')
})
check('列表标出运行中的对话', () => {
  assert.equal(all.conversations.find(row => row.id === 'session-1').running, true)
  assert.equal(all.conversations.find(row => row.id === 'old-a').running, false)
})

const noConfirm = await runClean('conversation_delete', { session_ids: ['old-a'] })
check('没有 confirm 就拒绝删除（原目录必须还在）', () => {
  assert.equal(noConfirm.refused, true)
  assert.ok(existsSync(join(home, 'sessions', '--F--', 'old-a')))
})

const refusedLive = await runClean('conversation_delete', { session_ids: ['session-1'], confirm: true })
check('拒绝删除正在运行的对话', () => {
  assert.equal(refusedLive.deleted.length, 0)
  assert.equal(refusedLive.refusedLive.length, 1)
  assert.ok(existsSync(join(home, 'sessions', '--F--', 'session-1')))
})

const deleted = await runClean('conversation_delete', { session_ids: ['old-a', 'old-b'], confirm: true })
check('删除是移入回收站，不是粉碎', () => {
  assert.equal(deleted.mode, 'recycle-bin')
  assert.equal(deleted.deleted.length, 2)
  assert.ok(!existsSync(join(home, 'sessions', '--F--', 'old-a')))
  assert.ok(!existsSync(join(home, 'sessions', '--G--', 'old-b')))
  assert.ok(existsSync(join(deleted.recycleBin, 'MANIFEST.json')), '回收站要有清单')
  assert.ok(existsSync(join(deleted.recycleBin, 'sessions', '--F--', 'old-a')), '正文应在回收站里')
})
check('删除后把回收站镜像写进了存活会话的工作区', () => {
  assert.ok(existsSync(mirrorFile), `镜像应存在于 ${mirrorFile}`)
  const mirror = JSON.parse(readFileSync(mirrorFile, 'utf8'))
  assert.equal(mirror.count, 1, JSON.stringify(mirror).slice(0, 200))
  assert.equal(mirror.batches.length, 1)
  assert.equal(mirror.batches[0].entries, 2)
  // 镜像只放概览：不得出现任何对话 id 或标题。
  const text = JSON.stringify(mirror)
  assert.ok(!text.includes('old-a') && !text.includes('旧对话'), '镜像不应包含对话 id 或标题')
})
check('trashMirror:false 时不往工作区写镜像', () => {
  const quiet = createFakeCtx()
  apply(quiet.ctx, { trashMirror: false })
  const fence = makeSession('session-9', [])
  fence.header.cwd = join(home, 'ws-off')
  quiet.sessions.set(fence.id, fence)
  quiet.fire('session/created', fence)
  assert.ok(!existsSync(join(home, 'ws-off', '.dsh-conversation-manager', 'trash.json')))
  quiet.disposeAll()
})

const restored = await runClean('conversation_restore', {})
check('可以从回收站原样恢复', () => {
  assert.equal(restored.restored.length, 2, JSON.stringify(restored).slice(0, 300))
  assert.ok(existsSync(join(home, 'sessions', '--F--', 'old-a')))
  assert.ok(existsSync(join(home, 'sessions', '--G--', 'old-b')))
})

const listAgain = await runClean('conversation_list_all', {})
const targetSeq = listAgain.conversations.find(row => row.id === 'old-b').seq
check('列表序号可用于删除', () => {
  assert.equal(typeof targetSeq, 'number')
  assert.ok(targetSeq >= 1, `seq=${targetSeq}`)
})
const purged = await runClean('conversation_delete', { seq: [targetSeq], confirm: true, permanent: true })
check('permanent:true 才真删', () => {
  assert.equal(purged.mode, 'permanent')
  assert.deepEqual(purged.erased, ['old-b'])
  assert.ok(!existsSync(join(home, 'sessions', '--G--', 'old-b')))
})

cleaner.disposeAll()
if (previousHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = previousHome
rmSync(home, { recursive: true, force: true })

// ── 7. 卸载即可逆效果 ───────────────────────────────────────────────────────
console.log('\n卸载与回收')
check('卸载后所有工具被回收（注册即可逆效果）', () => {
  assert.equal(harness.tools.size, 11, '卸载前应当是 11 个工具')
  harness.disposeAll()
  assert.equal(harness.tools.size, 0, '卸载后工具表应当清空')
})
console.log(`\n全部通过：${passed} 项检查\n`)
