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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply, inject, name } from '../index.js'
import { resolveDshHome } from '../lib/cleanup.js'
import { hasCjk, installCjkSearch, installCjkSearchAll, mergeSearchResults, truncateCodePoints } from '../lib/search-cjk.js'
import { MIRROR_RELATIVE_PATH } from '../lib/trash-mirror.js'

/** 包根目录（本文件在 <root>/test/ 下）。 */
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))

let passed = 0
/**
 * CI 里把失败写成 GitHub 注解（`::error::`）。
 *
 * 为什么需要：Actions 的日志端点在未鉴权时返回 403，光看 API 只能得到"某一步失败"，
 * 不知道是哪条断言。注解会出现在 run 的 annotations 里（公开可读），
 * 失败原因就能直接取到，不必先拿到日志。
 */
function announceFailure(message) {
  if (process.env.GITHUB_ACTIONS !== 'true') return
  // 用 writeSync 而不是 console.log：后面紧接着 process.exit(1)，
  // 管道上的异步 stdout 可能来不及刷出，注解就丢了。
  try {
    writeSync(1, `::error::${message}\n`)
  } catch {
    console.log(`::error::${message}`)
  }
}
/** 取栈里指向本测试文件的调用点：注解里带上它，就知道是哪一行失败的。 */
function where(error) {
  const frames = String(error?.stack ?? '').split('\n')
  const own = frames.filter(line => line.includes('smoke.mjs'))
  return (own[0] ?? frames.find(line => line.trim().startsWith('at ')) ?? '').trim()
}
process.on('uncaughtException', (error) => {
  announceFailure(`${error?.name ?? 'Error'}: ${error?.message ?? String(error)} @ ${where(error)}`)
  console.error(error)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  announceFailure(`unhandledRejection: ${reason?.message ?? String(reason)} @ ${where(reason)}`)
  console.error(reason)
  process.exit(1)
})
/** 同步检查；传入 async 回调会立刻报错，避免假通过。 */
function check(label, fn) {
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      throw new Error(`check("${label}") 收到 Promise，请改用 checkAsync`)
    }
  } catch (error) {
    announceFailure(`${label} — ${error?.message ?? String(error)}`)
    throw error
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
      // 宿主 `sessions.search` 的最小替身：中文兜底会包在它上面（见「官方搜索链上的中文兜底」）。
      // 返回形状与本机 app.asar 里的真实实现一致：`{ items: [{ sessionId, snippet }], hasMore }`。
      search: async (request) => ({
        items: [{ sessionId: 'base-session', snippet: `官方:${String(request?.query ?? request ?? '')}` }],
        hasMore: false,
      }),
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
/** apply 之前的官方 `sessions.search`：卸载后必须一模一样地还原回去。 */
const originalSessionsSearch = harness.ctx.sessions.search
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
// 宿主现在是**异步**实现（返回 Promise），所以这里连「Promise 里的会话要真的进索引」
// 一起验：apply 保持同步、不 await，也不能漏登记——否则 conversation_label 这类
// 「按 id 操作」的工具会对没打开过的对话报 Unknown conversation（本机实测过）。
// 两条形状都覆盖：存活会话（有 deriveMessages）与只有元数据的描述。
const hostile = createFakeCtx({ listReturnsPromise: true })
hostile.sessions.set('session-async-live', makeSession('session-async-live', []))
hostile.sessions.set('session-async-cold', {
  id: 'session-async-cold',
  title: '描述型会话',
  header: { cwd: join(tmpdir(), 'dsh-ws-fixture') },
})
await checkAsync('sessions.list() 返回 Promise 时插件仍能加载，且解析出的会话进索引', async () => {
  apply(hostile.ctx, {})
  assert.ok(hostile.tools.has('conversation_list'), '工具应当照常注册')
  // 等一个宏任务，让 .then 的回调跑完（插件故意不 await，apply 保持同步）。
  await new Promise((resolve) => setImmediate(resolve))
  const service = hostile.services.get('conversationManager')
  const ids = service.list({ limit: 100 }).map((row) => row.id)
  assert.ok(ids.includes('session-async-live'), `存活会话应当进索引，实际 ${JSON.stringify(ids)}`)
  assert.ok(ids.includes('session-async-cold'), `描述型会话也应当进索引，实际 ${JSON.stringify(ids)}`)
  const notes = service.diagnostics().notes
  assert.ok(
    !notes.some((note) => note.includes('补登记被跳过')),
    `不应再记「补登记被跳过」，实际 notes=${JSON.stringify(notes)}`,
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
  'conversation_purge',
]
check('十二个工具全部注册', () => {
  for (const toolName of expectedTools) assert.ok(harness.tools.has(toolName), `缺少 ${toolName}`)
})
// 两半各自打包、无法共享模块，镜像路径在两处各写一份；这里用产物做交叉验证，
// 免得改了宿主常量却忘了客户端（面板会静默读不到回收站）。
// 产物是构建物（dist/ 不入库），所以刚克隆下来还没构建时**跳过而不是失败**——
// 需要硬性检查产物时用 `pnpm run verify:client` / `pnpm run check:client`。
check('回收站镜像路径在两半之间一致', () => {
  const bundlePath = join(rootDir, 'dist', 'client.js')
  if (!existsSync(bundlePath)) {
    console.log('    ↷ 跳过：还没有 dist/client.js（先跑 pnpm run bundle 再做这条跨两半校验）')
    return
  }
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

const search = await run('conversation_search', { query: '插件', scan_disk: false })
check('conversation_search 命中正文并给出摘录', () => {
  assert.equal(search.hits.length, 1, JSON.stringify(search).slice(0, 200))
  assert.ok(search.hits[0].matches >= 1)
  assert.equal(search.diagnostics.diskScanned, null, '关掉磁盘扫描时不应有磁盘统计')
})

const miss = await run('conversation_search', { query: '绝对不存在的关键字zzz', scan_disk: false })
check('搜索无结果时返回空命中', () => {
  assert.deepEqual(miss.hits, [])
  assert.equal(miss.returned, 0)
})

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
  assert.equal(selftest.plugin.registeredTools.length, 12)
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

// 这条是 CI 抓出来的真 bug 的回归测试：磁盘回退必须与存活路径**同形状**。
// 当年 CI（Linux，没有 ~/.dsh）上 `resolveDshHome` 解析不出 home，代码只回了 { error }，
// 于是 available 是 undefined 而不是 false；本地因为 ~/.dsh 存在恰好走到"找不到对话"分支，
// 返回了 available: false，所以本地一直绿——形状不一致才是根因。
await checkAsync('磁盘回退无论何种失败原因，都保持 available/messages 的统一形状', async () => {
  const missing = await run('conversation_history', { conversation_id: 'definitely-not-on-disk', from_disk: true })
  assert.equal(missing.available, false, JSON.stringify(missing))
  assert.deepEqual(missing.messages, [])
  assert.equal(typeof missing.reason, 'string')
  // 本地有 ~/.dsh（走到"磁盘上找不到该对话"），CI 没有（走到"解析不到 home"）——
  // 两条都算合法失败路径，形状必须一致。
  assert.ok(missing.source === 'disk' || missing.source === 'none', String(missing.source))
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
// 之后再 apply 一个独立 harness —— 否则它会去动开发者真实的 $DSH_HOME。
console.log('\n磁盘清理（删除与恢复）')
const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
const fixture = [
  { id: 'session-1', ws: '--F--', title: '存活会话（不该被删）', first: '我在运行中', size: 128 },
  { id: 'old-a', ws: '--F--', title: '旧对话 A', first: '第一条消息 A', size: 256 },
  { id: 'old-b', ws: '--G--', title: '旧对话 B', first: '第一条消息 B', size: 64 },
  { id: 'old-c', ws: '--F--', title: '旧对话 C', first: '第一条消息 C', size: 96 },
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
// 关键：把它的工作区指到临时目录，否则回收站镜像会写进开发者真实的会话工作区。
liveFixture.header.cwd = join(home, 'ws')
cleaner.sessions.set(liveFixture.id, liveFixture)
cleaner.fire('session/created', liveFixture)
const mirrorFile = join(home, 'ws', '.dsh-conversation-manager', 'trash.json')
const runClean = (toolName, args = {}) => cleaner.tools.get(toolName).execute(args, { signal: new AbortController().signal })

const all = await runClean('conversation_list_all', {})
check('conversation_list_all 从磁盘列出全部对话（含标题与路径）', () => {
  assert.equal(all.total, 4, JSON.stringify(all).slice(0, 300))
  assert.deepEqual(all.conversations.map(row => row.id).sort(), ['old-a', 'old-b', 'old-c', 'session-1'])
  const row = all.conversations.find(candidate => candidate.id === 'old-a')
  assert.equal(row.title, '旧对话 A')
  assert.equal(row.workspace, 'F:\\demo')
})
check('列表标出运行中的对话', () => {
  assert.equal(all.conversations.find(row => row.id === 'session-1').running, true)
  assert.equal(all.conversations.find(row => row.id === 'old-a').running, false)
})

/* 冷对话改标题：索引里的记录只来自存活会话，没打开过的对话不在其中，必须能按需从磁盘补登记。
 * 这是本机实测的真实故障：30 个没打开过的对话全部报 Unknown conversation。 */
const renamedRequests = []
cleaner.ctx.set('sessionController', {
  rename: async (request) => {
    renamedRequests.push(request)
    return { title: request.title, seq: 1 }
  },
})
const coldLabel = await runClean('conversation_label', { conversation_id: 'old-c', title: '分组/旧对话 C' })
check('冷对话也能改标题：按需从磁盘补登记后走宿主的 rename', () => {
  assert.equal(coldLabel.conversationId, 'old-c')
  assert.equal(coldLabel.managerTitleUpdated, true)
  assert.equal(coldLabel.durable, true, JSON.stringify(coldLabel))
  assert.deepEqual(renamedRequests, [{ sessionId: 'old-c', title: '分组/旧对话 C' }])
})
check('一次补登记把磁盘上的对话都装进索引（不必每条扫一次盘）', () => {
  const ids = cleaner.services.get('conversationManager').list({ limit: 100 }).map(row => row.id)
  for (const id of ['old-a', 'old-b', 'old-c', 'session-1']) {
    assert.ok(ids.includes(id), `${id} 应当进索引，实际 ${JSON.stringify(ids)}`)
  }
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
  assert.ok(!existsSync(join(home, 'ws-off', '.dsh-conversation-manager', 'status.json')),
    'trashMirror:false 是"一个字节都不写"，状态快照也必须停')
  quiet.disposeAll()
})

/* ── 宿主状态快照：外部可读的验收凭证（0.5.1）──
 * 0.5.0 包错了对象却没人发现，就是因为宿主侧"装没装上"没有可读的证据。
 * 现在把它落成文件：只含版本与自检账本，绝不含会话内容。 */
const statusFile = join(home, 'ws', '.dsh-conversation-manager', 'status.json')
check('宿主状态快照写进了存活会话的工作区（验收凭证）', () => {
  assert.ok(existsSync(statusFile), `快照应存在于 ${statusFile}`)
  const status = JSON.parse(readFileSync(statusFile, 'utf8'))
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
  assert.equal(status.plugin, 'conversation-manager')
  assert.equal(status.version, pkg.version, `版本号要与 package.json 一致：${JSON.stringify(status)}`)
  assert.equal(typeof status.cjkSearch?.installed, 'boolean')
  assert.ok(status.cjkSearch !== undefined && typeof status.cjkSearch.targets === 'object', JSON.stringify(status))
  assert.equal(typeof status.at, 'string')
  // 隐私：快照只放版本与计数，绝不能出现会话正文或会话 id。
  const text = JSON.stringify(status)
  assert.ok(!text.includes('我在运行中'), '快照不得包含对话正文')
  assert.ok(!text.includes('session-1'), '快照不得包含会话 id')
})
check('statusFile:false 只停写状态快照，回收站镜像照常', () => {
  const noStatus = createFakeCtx()
  apply(noStatus.ctx, { statusFile: false })
  const fence = makeSession('session-10', [])
  fence.header.cwd = join(home, 'ws-nostatus')
  noStatus.sessions.set(fence.id, fence)
  noStatus.fire('session/created', fence)
  assert.ok(existsSync(join(home, 'ws-nostatus', '.dsh-conversation-manager', 'trash.json')), '镜像应当照常写')
  assert.ok(!existsSync(join(home, 'ws-nostatus', '.dsh-conversation-manager', 'status.json')),
    '状态快照应当被 statusFile:false 关掉')
  noStatus.disposeAll()
})
check('apply 时没有存活会话：首个会话事件保证快照至少写出一次', () => {
  const later = createFakeCtx()
  apply(later.ctx, {})
  const ws = join(home, 'ws-late-status')
  const file = join(ws, '.dsh-conversation-manager', 'status.json')
  assert.ok(!existsSync(file), 'apply 时还没有任何工作区可写')
  const session = makeSession('session-late-status', [])
  session.header.cwd = ws
  later.sessions.set(session.id, session)
  later.fire('session/event', session, {
    seq: 1,
    time: Date.now(),
    type: 'user/message',
    data: { content: [{ type: 'text', text: '中文' }] },
  })
  assert.ok(existsSync(file), `首个会话事件后应当写出快照：${file}`)
  const status = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(status.cjkSearch.installed, true, JSON.stringify(status))
  assert.ok(!JSON.stringify(status).includes('中文'), '快照不得包含消息正文')
  later.disposeAll()
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

/* ── 清空回收站：先造一个新批次，再验证三道安全措施 ── */
// 恢复测试已把两批清空；这里再造出内容，供「清空回收站」验证。
// 注意批次名精确到秒：两次删除若落在同一秒，会复用同一个批次目录，
// 因此后面的断言只依赖"释放的对话总数"，不依赖批次数。
const purgeTarget1 = await runClean('conversation_delete', { session_ids: ['old-a'], confirm: true })
check('清空测试的准备：再删两个对话', () => {
  assert.equal(purgeTarget1.deleted.length, 1)
  assert.equal(purgeTarget1.recycleBin.split(/[\\/]/).pop(), purgeTarget1.batch)
})

const purgeTarget2 = await runClean('conversation_delete', { session_ids: ['old-c'], confirm: true })
check('清空测试的准备：第二个对话也已入回收站', () => {
  assert.equal(purgeTarget2.deleted.length, 1)
  assert.ok(purgeTarget2.recycleBin.startsWith(home), '回收站应位于本夹具的 DSH_HOME 下')
})

const purgeNoConfirm = await runClean('conversation_purge', { all: true })
check('清空回收站必须 confirm:true', () => {
  assert.equal(purgeNoConfirm.refused, true)
  assert.ok(existsSync(purgeTarget1.recycleBin), '没有确认时批次必须还在')
})

const noTarget = await runClean('conversation_purge', { confirm: true })
check('不指定 all/batch 时拒绝执行并报出可选批次', () => {
  assert.ok(typeof noTarget.error === 'string')
  assert.ok(Array.isArray(noTarget.available) && noTarget.available.length >= 1)
})

const bogus = await runClean('conversation_purge', { batch: '../..', confirm: true })
check('批次名不在回收站里时拒绝（不做路径拼接删除）', () => {
  assert.equal(bogus.purged.length, 0)
  assert.ok(existsSync(join(home, 'sessions')), '仓库外/上级目录绝不能被删到')
})

const emptied = await runClean('conversation_purge', { all: true, confirm: true })
check('all:true 清空全部批次并报出释放空间', () => {
  // 批次名精确到秒，同一秒内的多次删除会落进同一个批次，
  // 所以断言"释放的对话总数"而非批次数——批次数取决于运行速度。
  const freed = emptied.purged.reduce((sum, entry) => sum + (entry.entries ?? 0), 0)
  assert.equal(freed, 2, JSON.stringify(emptied).slice(0, 300))
  assert.ok(emptied.freedKB > 0, `应报出释放的空间，实际 ${emptied.freedKB}`)
  assert.equal(emptied.recycleBin.length, 0)
  assert.ok(!existsSync(join(home, 'session-trash')), '清空后回收站空壳目录也应被收掉')
})

/* ── 磁盘正文搜索（0.3.1 的核心）：中文子串必须能搜到 ──
 * 自带内容索引跑在 FTS5 `unicode61` 上，把一整串连续中文当一个词元，
 * 所以「内容检索示例」里的「检索」搜不到。这里造一份**两帧拼接**的真日志
 * （DSH 追加写法的真实形态），验证多帧解压 + 字面子串匹配。 */
const memoId = 'memo-zh-1'
const memoDir = join(home, 'sessions', '--F--', memoId)
mkdirSync(memoDir, { recursive: true })
const memoFrames = [
  JSON.stringify({ type: 'user/message', seq: 1, time: Date.now() - 60000, data: { content: [{ type: 'text', text: '这是一句内容检索示例，用来验证子串搜索' }] } }),
  // 助手消息的真实形状是 data.message.content（user/message 才是 data.content）——
  // 两种都按真身写，才能同时验证"搜索读得到"和"投影认得出来"。
  JSON.stringify({ type: 'assistant/message', seq: 2, time: Date.now() - 30000, data: { message: { content: [{ type: 'text', text: '内容检索示例：子串必须能命中' }] } } }),
]
writeFileSync(
  join(memoDir, 'session.v4.jsonl.zstd'),
  Buffer.concat(memoFrames.map(frame => zstdCompressSync(Buffer.from(`${frame}\n`, 'utf8')))),
)

const zh = await runClean('conversation_search', { query: '检索', limit: 5 })
check('磁盘正文搜索：中文子串命中（自带 FTS 分词器做不到的事）', () => {
  const hit = zh.hits.find(row => row.id === memoId)
  assert.ok(hit, JSON.stringify(zh).slice(0, 400))
  assert.equal(hit.matches, 2, '两帧里各出现一次')
  assert.ok(String(hit.snippet).includes('检索'), String(hit.snippet))
  assert.equal(hit.source, 'disk')
})
check('磁盘扫描如实报告规模与耗时', () => {
  assert.ok(zh.diagnostics.diskScanned >= 1, JSON.stringify(zh.diagnostics))
  assert.equal(typeof zh.diagnostics.diskElapsedMs, 'number')
  assert.equal(zh.diagnostics.diskTimedOut, false)
})
check('搜索结果带回命中位置（seq / 事件类型）', () => {
  const hit = zh.hits.find(row => row.id === memoId)
  assert.equal(hit.seq, 1, JSON.stringify(hit))
  assert.equal(hit.eventType, 'user/message')
  assert.equal(typeof hit.at, 'string')
})

/* ── 原文对照：DSH 没有事件深链接，所以"看那句话的上下文"必须由工具提供 ── */
const coldHistory = await runClean('conversation_history', { conversation_id: memoId })
check('冷对话（未装载）也能读历史——自动回退到磁盘', () => {
  assert.equal(coldHistory.available, true, JSON.stringify(coldHistory).slice(0, 300))
  assert.equal(coldHistory.source, 'disk')
  assert.equal(coldHistory.messageCount, 2)
  assert.ok(String(coldHistory.messages[0].text).includes('检索'), JSON.stringify(coldHistory.messages[0]))
})

const aroundHistory = await runClean('conversation_history', { conversation_id: memoId, around_seq: 2, window: 5 })
check('around_seq：只取命中处附近的消息（原文对照）', () => {
  assert.equal(aroundHistory.available, true)
  assert.equal(aroundHistory.aroundSeq, 2)
  assert.ok(aroundHistory.messages.length >= 1)
  assert.ok(aroundHistory.messages.every(row => typeof row.seq === 'number'))
  assert.ok(aroundHistory.messages.some(row => String(row.text).includes('内容检索示例')), JSON.stringify(aroundHistory.messages))
})

const withContext = await runClean('conversation_search', { query: '检索', limit: 5, include_context: true, context_window: 5 })
check('include_context：搜索直接把命中处前后的原文一起带回', () => {
  const hit = withContext.hits.find(row => row.id === memoId)
  assert.ok(Array.isArray(hit.context), JSON.stringify(withContext).slice(0, 400))
  assert.ok(hit.context.length >= 1)
  assert.equal(withContext.diagnostics.contextAttached, 1)
})
// 内容不是 zstd 的日志（夹具里 session-1 是 'x'.repeat(128)）不会报错，只是解出 0 条事件
// —— 残缺日志不该拖垮整次搜索。真正读不开的情况才进 unreadable，
// 这里用"日志路径是个目录"构造一个确定性的读取失败。
const badLogId = 'bad-log-1'
mkdirSync(join(home, 'sessions', '--F--', badLogId, 'session.v4.jsonl.zstd'), { recursive: true })
const zh2 = await runClean('conversation_search', { query: '检索', limit: 5 })
check('读不开的日志进 unreadable，且不影响其它命中', () => {
  assert.ok(Array.isArray(zh2.diagnostics.diskUnreadable), JSON.stringify(zh2.diagnostics))
  assert.ok(zh2.diagnostics.diskUnreadable.some(item => item.id === badLogId), JSON.stringify(zh2.diagnostics.diskUnreadable))
  assert.ok(zh2.hits.some(row => row.id === memoId), '其它对话的命中照常返回')
})
const zhNone = await runClean('conversation_search', { query: '绝对不存在的关键字zzz' })
check('磁盘正文搜索无命中时返回空', () => assert.deepEqual(zhNone.hits, []))

/* ── 6b. 官方搜索链上的中文兜底（0.5.0 引入）──
 * 插件把宿主的搜索入口包了一层：查询含 CJK 时补一次磁盘字面扫描。
 * 官方放大镜与本插件面板走的都是这一个入口，所以这里测的就是"两处一起修好"的那条路。
 * 此刻 process.env.DSH_HOME 指向上面的夹具，因此扫描会真的读到 memo-zh-1。 */
console.log('\n官方搜索链上的中文兜底')
check('apply 时已把宿主 sessions.search 包上（并记进自检账本）', () => {
  const cjk = harness.services.get('conversationManager').diagnostics().cjkSearch
  assert.equal(cjk.installed, true, JSON.stringify(cjk))
  assert.notEqual(harness.ctx.sessions.search, originalSessionsSearch, '应当已经不是原方法')
})

await checkAsync('英文查询原样通过：一次磁盘扫描都不做', async () => {
  const result = await harness.ctx.sessions.search({ query: 'session search' })
  assert.deepEqual(result.items.map((row) => row.sessionId), ['base-session'])
  assert.equal(result.hasMore, false)
  const cjk = harness.services.get('conversationManager').diagnostics().cjkSearch
  assert.equal(cjk.calls, 0, `英文不该触发扫描，实际 ${JSON.stringify(cjk)}`)
})

await checkAsync('中文子串查询：磁盘命中被合并进官方结果（官方放大镜同一条路）', async () => {
  const result = await harness.ctx.sessions.search({ query: '检索' })
  const ids = result.items.map((row) => row.sessionId)
  assert.equal(ids[0], 'base-session', `官方结果必须排在最前，实际 ${JSON.stringify(ids)}`)
  assert.ok(ids.includes('memo-zh-1'), `应当补上磁盘命中，实际 ${JSON.stringify(ids)}`)
  const hit = result.items.find((row) => row.sessionId === 'memo-zh-1')
  assert.ok(String(hit.snippet).includes('检索'), `片段必须含查询词（面板靠它高亮）：${JSON.stringify(hit)}`)
  assert.ok(Array.isArray(hit.snippet) === false && Array.from(String(hit.snippet)).length <= 240, '片段按码点截到 240')
  const cjk = harness.services.get('conversationManager').diagnostics().cjkSearch
  assert.equal(cjk.calls, 1, JSON.stringify(cjk))
  assert.ok(cjk.added >= 1, JSON.stringify(cjk))
  assert.equal(typeof cjk.lastElapsedMs, 'number')
})

await checkAsync('同一查询在缓存窗口内只扫一次磁盘', async () => {
  await harness.ctx.sessions.search({ query: '检索' })
  const cjk = harness.services.get('conversationManager').diagnostics().cjkSearch
  assert.equal(cjk.calls, 1, `第二次应当复用上次扫描，实际 ${JSON.stringify(cjk)}`)
  assert.equal(cjk.cacheHits, 1, `复用要单独计数，实际 ${JSON.stringify(cjk)}`)
})

await checkAsync('兜底没有把返回形状改坏（仍是 items/hasMore）', async () => {
  const result = await harness.ctx.sessions.search({ query: '检索' })
  assert.deepEqual(Object.keys(result).sort(), ['hasMore', 'items'])
  assert.ok(result.items.every((row) => typeof row.sessionId === 'string' && typeof row.snippet === 'string'))
})

/* ── 6c. 补丁必须挂在 sessionController 上（0.5.0 的教训，防复发）──
 * 网关把 `remote.session.search` 绑在 `sessionController`（`namespace: "session"`），
 * 而 `ctx.sessions` 是会话存储（同步 list()）——0.5.0 只包了后者，
 * 面上一切正常、功能却是空的：补丁一次都没被调用过。 */
console.log('\n补丁目标：sessionController（网关真正的入口）')
const controllerService = {
  search: async (request) => ({
    items: [{ sessionId: 'base-session', snippet: `官方:${request?.query ?? ''}` }],
    hasMore: false,
  }),
}
const originalControllerSearch = controllerService.search
const withController = createFakeCtx()
withController.ctx.set('sessionController', controllerService)
apply(withController.ctx, {})

check('sessionController.search 被包上，账本记下每个候选的状态', () => {
  const cjk = withController.services.get('conversationManager').diagnostics().cjkSearch
  assert.equal(cjk.installed, true, JSON.stringify(cjk))
  assert.equal(cjk.targets.sessionController, 'installed', JSON.stringify(cjk.targets))
  assert.equal(cjk.targets.sessions, 'installed', JSON.stringify(cjk.targets))
  assert.notEqual(controllerService.search, originalControllerSearch, '网关入口必须已经不是原方法')
})

/* 状态快照就是我在真机上要读的那份凭证：把"补丁挂在 sessionController 上"落成文件。 */
const controllerWs = join(home, 'ws-controller')
const controllerSession = makeSession('session-controller-ws', [])
controllerSession.header.cwd = controllerWs
withController.sessions.set(controllerSession.id, controllerSession)
withController.fire('session/created', controllerSession)
check('状态快照如实记录「补丁挂在 sessionController 上」', () => {
  const file = join(controllerWs, '.dsh-conversation-manager', 'status.json')
  assert.ok(existsSync(file), `快照应存在于 ${file}`)
  const status = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(status.cjkSearch.installed, true, JSON.stringify(status))
  assert.equal(status.cjkSearch.targets.sessionController, 'installed', JSON.stringify(status.cjkSearch))
  assert.ok(!JSON.stringify(status).includes('session-controller-ws'), '快照不得包含会话 id')
})

await checkAsync('经 sessionController 的中文查询真的补进磁盘命中', async () => {
  const result = await controllerService.search({ query: '检索' })
  const ids = result.items.map((row) => row.sessionId)
  assert.equal(ids[0], 'base-session', `官方结果在前，实际 ${JSON.stringify(ids)}`)
  assert.ok(ids.includes('memo-zh-1'), `网关入口也必须拿到磁盘命中，实际 ${JSON.stringify(ids)}`)
})

const late = createFakeCtx()
apply(late.ctx, {})
check('apply 时 sessionController 缺席：如实记 absent，不冒充装上', () => {
  const cjk = late.services.get('conversationManager').diagnostics().cjkSearch
  assert.equal(cjk.targets.sessionController, 'absent', JSON.stringify(cjk.targets))
  assert.equal(cjk.targets.sessions, 'installed', JSON.stringify(cjk.targets))
  assert.equal(cjk.installed, true, JSON.stringify(cjk))
  assert.equal(cjk.attempts, 1, JSON.stringify(cjk))
})
const lateController = { search: async () => ({ items: [], hasMore: false }) }
const lateOriginalSearch = lateController.search
late.ctx.set('sessionController', lateController)
late.fire('session/event', makeSession('session-late', []), {
  seq: 1,
  time: Date.now(),
  type: 'user/message',
  data: { content: [{ type: 'text', text: '中文' }] },
})
check('sessionController 晚注册时，第一个会话事件把它补装上（重试机制）', () => {
  assert.notEqual(lateController.search, lateOriginalSearch, '应当已被包上')
  const cjk = late.services.get('conversationManager').diagnostics().cjkSearch
  assert.equal(cjk.targets.sessionController, 'installed', JSON.stringify(cjk.targets))
  assert.equal(cjk.attempts, 2, JSON.stringify(cjk))
})

withController.disposeAll()
late.disposeAll()
check('卸载把 sessionController.search 也还原回原方法', () => {
  assert.equal(controllerService.search, originalControllerSearch, '网关入口应当与 apply 前一模一样')
  assert.equal(lateController.search, lateOriginalSearch, '晚注册的入口同样要还原')
})

cleaner.disposeAll()
if (previousHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = previousHome
rmSync(home, { recursive: true, force: true })

// ── 7. 中文兜底的单元行为 ────────────────────────────────────────────────────
console.log('\n中文搜索兜底（单元）')
check('hasCjk 只认中日韩文字（英文与空串不触发兜底）', () => {
  assert.equal(hasCjk('检索'), true)
  assert.equal(hasCjk('ドキュメント'), true)
  assert.equal(hasCjk('대화'), true)
  assert.equal(hasCjk('中英 mixed 混合'), true)
  assert.equal(hasCjk('session search'), false)
  assert.equal(hasCjk(''), false)
  assert.equal(hasCjk(undefined), false)
})
check('mergeSearchResults：官方结果在前、两边都有的保留官方片段', () => {
  const merged = mergeSearchResults(
    { items: [{ sessionId: 'a', snippet: '官方片段' }], hasMore: false },
    [{ id: 'a', snippet: '磁盘片段' }, { id: 'b', snippet: '磁盘命中 B' }],
  )
  assert.deepEqual(merged.items.map((row) => row.sessionId), ['a', 'b'])
  assert.equal(merged.items[0].snippet, '官方片段')
  assert.equal(merged.hasMore, false)
})
check('mergeSearchResults：超出 20 条上限时如实标 hasMore', () => {
  const extras = Array.from({ length: 25 }, (_, i) => ({ id: `s-${i}`, snippet: 'x' }))
  const merged = mergeSearchResults({ items: [], hasMore: false }, extras, 20)
  assert.equal(merged.items.length, 20)
  assert.equal(merged.hasMore, true)
  assert.equal(mergeSearchResults({ items: [], hasMore: true }, [], 20).hasMore, true, '官方的 hasMore 不能丢')
})
check('mergeSearchResults：形状不认识时原样返回（不猜别人的契约）', () => {
  const weird = { rows: [] }
  assert.equal(mergeSearchResults(weird, [{ id: 'a' }]), weird)
  assert.equal(mergeSearchResults(undefined, [{ id: 'a' }]), undefined)
})
check('truncateCodePoints 按码点截断，不劈开代理对', () => {
  assert.equal(Array.from(truncateCodePoints('检索'.repeat(200), 240)).length, 240)
  assert.equal(truncateCodePoints('短', 240), '短')
  assert.equal(truncateCodePoints('长'.repeat(300), 240), '长'.repeat(240))
})
check('installCjkSearch：没有 search 方法时如实报告（不抛错）', () => {
  const outcome = installCjkSearch({})
  assert.equal(outcome.installed, false)
  assert.equal(outcome.reason, 'search-unavailable')
})
check('restore 把继承来的方法放回原处（不留自己的属性）', () => {
  const proto = { search: async () => ({ items: [], hasMore: false }) }
  const target = Object.create(proto)
  const outcome = installCjkSearch(target, { scan: () => [] })
  assert.equal(outcome.installed, true)
  assert.notEqual(target.search, proto.search, '应当已经打上补丁')
  outcome.restore()
  assert.equal(Object.hasOwn(target, 'search'), false)
  assert.equal(target.search, proto.search)
})
check('installCjkSearchAll：逐个候选安装并汇总状态（缺席如实记 absent）', () => {
  const target = { search: async () => ({ items: [], hasMore: false }) }
  const original = target.search
  const outcome = installCjkSearchAll(
    [{ name: 'sessionController', target: undefined }, { name: 'sessions', target }],
    { scan: () => [] },
  )
  assert.equal(outcome.installed, true)
  assert.deepEqual(outcome.targets, { sessionController: 'absent', sessions: 'installed' })
  assert.notEqual(target.search, original, '安装后应当已经是补丁')
  outcome.restore()
  assert.equal(target.search, original, 'restore 必须把装上的都还原回原方法')
})
check('installCjkSearchAll：同一对象只装一次（两个候选指向同一个服务）', () => {
  const target = { search: async () => ({ items: [], hasMore: false }) }
  const original = target.search
  const outcome = installCjkSearchAll([{ name: 'a', target }, { name: 'b', target }], { scan: () => [] })
  assert.equal(outcome.targets.a, 'installed')
  assert.equal(outcome.targets.b, 'same-as-before')
  outcome.restore()
  assert.equal(target.search, original, '还原后必须与安装前一模一样')
})
await checkAsync('installCjkSearch：官方抛错时原样往外抛（错误语义不变）', async () => {
  const target = { search: async () => { throw new Error('search is disabled') } }
  installCjkSearch(target, { scan: () => { throw new Error('兜底不该被调用') } })
  await assert.rejects(() => target.search({ query: '中文' }), /search is disabled/)
})
await checkAsync('installCjkSearch：兜底扫描出错也返回官方结果（失败不外溢）', async () => {
  const warnings = []
  const target = { search: async () => ({ items: [{ sessionId: 'x', snippet: '官方' }], hasMore: false }) }
  installCjkSearch(target, { scan: () => { throw new Error('磁盘炸了') }, log: { warn: (m) => warnings.push(m) } })
  const result = await target.search({ query: '中文' })
  assert.deepEqual(result.items.map((row) => row.sessionId), ['x'])
  assert.equal(warnings.length, 1, JSON.stringify(warnings))
  assert.ok(warnings[0].includes('磁盘炸了'), warnings[0])
})
await checkAsync('installCjkSearch：英文查询不触发扫描、返回值逐字不变', async () => {
  let scanned = 0
  const base = { items: [{ sessionId: 'x', snippet: 'official' }], hasMore: false }
  const target = { search: async () => base }
  installCjkSearch(target, { scan: () => { scanned += 1; return [] } })
  const result = await target.search({ query: 'session search' })
  assert.equal(scanned, 0)
  assert.deepEqual(result, base)
})
await checkAsync('installCjkSearch：同一查询在 TTL 内只扫一次磁盘', async () => {
  let scanned = 0
  const target = { search: async () => ({ items: [], hasMore: false }) }
  installCjkSearch(target, {
    ttlMs: 60_000,
    scan: () => { scanned += 1; return [{ id: 'zh-1', snippet: '命中' }] },
  })
  const first = await target.search({ query: '检索' })
  const second = await target.search({ query: '检索' })
  assert.equal(scanned, 1)
  assert.equal(first.items.length, 1)
  assert.deepEqual(second.items.map((row) => row.sessionId), ['zh-1'])
  const other = await target.search({ query: '归档' })
  assert.equal(scanned, 2, '换查询要重新扫')
  assert.ok(other.items.length >= 0)
})

// ── 8. 卸载即可逆效果 ───────────────────────────────────────────────────────
console.log('\n卸载与回收')
check('卸载后所有工具被回收（注册即可逆效果）', () => {
  assert.equal(harness.tools.size, 12, '卸载前应当是 12 个工具')
  harness.disposeAll()
  assert.equal(harness.tools.size, 0, '卸载后工具表应当清空')
})
check('卸载把官方 sessions.search 还原回原方法（补丁不留残余）', () => {
  assert.equal(harness.ctx.sessions.search, originalSessionsSearch, 'search 应当与 apply 前一模一样')
})
console.log(`\n全部通过：${passed} 项检查\n`)
