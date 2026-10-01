/**
 * 自包含的客户端 bundle 构建配置。
 *
 * 它复刻了 DSH 仓库共享预设 `packages/client/tsdown.client.ts` 里 clientConfig 的
 * 产物契约（不依赖仓库 checkout，因此 git 安装时 pnpm 运行的 prepare 也能工作）：
 *
 *   - 输出 CJS，并用 banner/footer 把整包裹成一次
 *     `window.__ModuleLoader__.load({ id, factory: (require) => { ... } })` 注册——
 *     Web 启动内核的 lazy CJS 模块表只认这种「注册 factory」的 bundle；
 *   - 平台模块（react、ui-primitives 等，见仓库
 *     `packages/client/web/src/platform.ts` 的 PLATFORM_MODULES）保持 external，
 *     运行时由模块表的 require 解析，绝不打进 bundle（打进去就是第二份 React）；
 *   - 其余 @deepseek-ai/* 一律只能 `import type`（编译期被擦除，根本到不了
 *     bundler）。纯度门插件把任何运行时值导入变成构建错误，与仓库内规则一致：
 *     跨插件协作走 cordis service，不走值导入。
 *
 * JSX：tsdown/Rolldown 对 .tsx 的默认转换是 **automatic**（见 tsdown 文档
 * 「React 支持」：classic 才需要显式设置 transform.jsx），因此产物 import 的是
 * `react/jsx-runtime` —— 它正是平台模块表成员，无需额外配置。若将来默认值变了，
 * 这里要显式指定 automatic，否则会退化成 classic 的 React.createElement。
 */
import { defineConfig } from 'tsdown'

const ID = 'dsh-conversation-manager'

/**
 * 浏览器平台模块表（对齐 PLATFORM_MODULES）。运行时只允许 import 这些说明符。
 */
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

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'dist',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  deps: {
    neverBundle: (specifier: string) => PLATFORM_MODULES.has(specifier),
    alwaysBundle: (specifier: string) => !PLATFORM_MODULES.has(specifier),
  },
  plugins: [
    {
      // bundle 纯度门（仓库同名规则的独立实现）：运行时代码不得 import
      // 平台模块表之外的 @deepseek-ai/* 值。type-only 导入在转译前即被擦除，
      // 永远不会到达这个钩子。
      name: 'dsh-client-bundle-purity',
      resolveId(source: string): null {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (PLATFORM_MODULES.has(source)) return null
        throw new Error(
          `client bundle purity: "${source}" 不在平台模块表中。` +
          '跨插件值导入会内联出第二份运行时（React/cordis 的单例会碎）——' +
          '请改成 import type，或通过 cordis service 协作。',
        )
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: (chunk: { isEntry: boolean; fileName: string }) =>
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
