#!/usr/bin/env node
/**
 * dist/client.js 产物自检——不需要 DSH、不需要浏览器，只要 node。
 *
 * 检查三件事，任何一件不成立都说明 bundle 与 Web 启动内核的契约不符：
 *   1. 首行是闭包工厂注册 window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {
 *   2. 末尾是 return module.exports; } });
 *   3. bundle 里所有的 require("<说明符>") 都在平台模块白名单内
 *      —— 出现别的 @deepseek-ai/* 就意味着某处运行时值导入绕过了纯度门，
 *      打进去的是第二份运行时（React/cordis 单例会碎）。
 *
 * 用法：
 *   node scripts/verify-client.mjs            # 检查 dist/client.js
 *   node scripts/verify-client.mjs <路径>      # 检查指定产物
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/** 与 DSH packages/client/web/src/platform.ts 的 PLATFORM_MODULES 对齐。 */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

const PACKAGE_ID = 'dsh-conversation-manager'

const here = dirname(fileURLToPath(import.meta.url))
const target = process.argv[2] ?? resolve(here, '..', 'dist', 'client.js')

const failures = []
const notes = []

let source
try {
  source = readFileSync(target, 'utf8')
} catch (error) {
  console.error(`无法读取 ${target}`)
  console.error('先构建：pnpm install && pnpm run bundle')
  console.error(String(error))
  process.exit(1)
}

// 去掉 sourcemap 注释后再做首尾断言：rolldown 会把 banner/footer 格式化到多行，
// 所以这里用宽松匹配，而不是硬编码单行写法。
const code = source.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '').trimEnd()

// 1. 工厂注册头：window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {
const head = code.slice(0, 800)
const headerPattern = new RegExp(
  `window\\.__ModuleLoader__\\.load\\(\\s*\\{[\\s\\S]*?id:\\s*["']${PACKAGE_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][\\s\\S]*?factory:\\s*\\(require\\)\\s*=>`,
)
if (!headerPattern.test(head)) {
  failures.push('缺少工厂注册头：期望 window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {')
} else {
  notes.push('工厂注册头存在')
}

// 2. 工厂注册尾：return module.exports; } });
if (!/return\s+module\.exports;\s*\}\s*\}\s*\);\s*$/.test(code)) {
  failures.push('末尾缺少工厂返回尾部：return module.exports; } });')
} else {
  notes.push('工厂返回尾部存在')
}

// 3. 工厂必须真的导出插件契约，否则内核拿不到可激活的插件。
for (const key of ['name', 'apply']) {
  if (!new RegExp(`exports\\.${key}\\s*=`).test(code)) {
    failures.push(`产物没有导出 ${key}（exports.${key} = ...）`)
  }
}
if (new RegExp('exports\\.inject\\s*=').test(code)) notes.push('导出 name / inject / apply')
else notes.push('导出 name / apply')

// 3. require 说明符必须在平台模块表内（相对路径与打包器内部模块除外）。
const requires = new Set()
const requirePattern = /require\(\s*(["'])([^"']+)\1\s*\)/g
let match
while ((match = requirePattern.exec(source)) !== null) {
  const specifier = match[2]
  // 相对/绝对路径是打包器自己的 chunk 引用，不是模块表请求。
  if (specifier.startsWith('.') || specifier.startsWith('/')) continue
  requires.add(specifier)
}

const offenders = [...requires].filter(specifier => !PLATFORM_MODULES.has(specifier))
for (const specifier of requires) {
  if (PLATFORM_MODULES.has(specifier)) notes.push(`external ok: ${specifier}`)
}
if (offenders.length > 0) {
  failures.push(
    `发现平台模块表之外的 require：${offenders.join(', ')}\n` +
    '  —— 运行时值导入绕过了纯度门；请改成 import type，或通过 cordis service 协作。',
  )
} else if (requires.size === 0) {
  notes.push('未发现任何 require（若确认没有外部依赖，可接受）')
}

// 4. 反向自查：确认没有把 React 内联进来（内联会有 React 的实现特征串）。
if (/react\.createElement|useSyncExternalStore/.test(source) && !requires.has('react')) {
  failures.push('疑似把 React 实现内联进了 bundle（存在 React 实现特征串，却没有 require("react")）')
}

console.log(`产物：${target}`)
console.log(`大小：${source.length} 字节`)
for (const note of notes) console.log(`  · ${note}`)
console.log(`模块表请求：${requires.size === 0 ? '（无）' : [...requires].join(', ')}`)

if (failures.length > 0) {
  console.error('\n失败：')
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log('\n通过：产物符合 Web 启动内核的闭包工厂契约，且未越出平台模块表。')
