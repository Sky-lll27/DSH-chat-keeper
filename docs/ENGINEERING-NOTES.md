# DSH 对话管理器 · 工程笔记

> 这是本插件的**开发过程记录**：契约核对、逐项验证数据、踩过的坑与取舍理由。
> 面向使用者与安装说明请看仓库根目录的 [README](../README.md)；本文件面向维护者，
> 保留原始细节（包括在开发机上实测得到的数字），便于复现与回归。
>
> 文中出现的 `<plugin-dir>`、`<DSH_HOME>` 是占位符：前者是本仓库的绝对路径，
> 后者是 DSH 的家目录（`$DSH_HOME`，默认 `~/.dsh`）。

一个真正接入 DeepSeek Harness（DSH）插件体系的对话管理器插件。它由两半组成：

| 半 | 文件 | 作用 |
| --- | --- | --- |
| **宿主半** | `index.js` + `lib/` | 12 个模型可调用工具（含**磁盘层面的删除 / 回收站 / 恢复 / 清空**）、会话索引、`conversationManager` 服务（纯 JS，无需构建） |
| **浏览器半** | `src/client/` → `dist/client.js` | Web GUI 里的「对话管理器」页签 + 会话行菜单项（TypeScript + React，需构建） |

## 安装状态（开发机实测）

以下是开发机上的验证记录（保留原始数据，便于复现）：

```yaml
# <DSH_HOME>\profiles\desktop\cordis.patch.yml 末尾追加了这 4 行：
- insert:
    - id: conversation-manager
      name: '<plugin-dir>/index.js'
```

- **原始配置已备份**：同目录 `cordis.patch.yml.bak-<时间戳>`（我这边也存了一份）。
  想卸载：删掉上面 4 行（或把 `.bak-*` 换回来）即可，不留任何其它改动。
- **宿主半已确认在运行**：本实例里 `conversation_*` 8 个工具已注册，
  `conversation_selftest` 报告 `managerExposedVia: "provide"`、
  `sessions/agents/sessionController` 全部就位、已跟踪 **6 个真实会话**并实时收到 `session/event`。
- **浏览器半已构建**：`dist/client.js` 42.94 kB（tsdown 0.23.0 / rolldown 1.2.11），
  产物自检 + 契约冒烟测试 **33/33 通过**（见 `scripts/`）。
- **接入链路已按本机源码核对**：客户端扫描器对 Loader 行向上找最近 `package.json`
  （所以绝对路径挂载也会带上浏览器半）、对 `dsh.client.inject` 里的未知包名是**跳过而非报错**、
  产物路径**没有目录限制**、增量重扫由 `internal/plugin` 事件触发——因此本插件是**热装载**的，
  改完配置**刷新页面**即可，不必重启应用。

> ⚠️ **界面还需你在页面上确认一次**：我无法访问带鉴权的页面（应用整体有令牌保护，
> 按官方指引我不应去翻令牌）。请按 `F5` 刷新后，看右侧 Sidebar 的引导页里是否出现
> **「对话管理器」**入口；左侧任意会话的 `...` 菜单里应多出**「在对话管理器中定位」**。

## 它做什么

| 能力 | 实现方式（DSH 契约） |
| --- | --- |
| 追踪对话生命周期 | 订阅 `session/created` / `session/disposed` / `session/event`，从**唯一真源**的会话事件日志派生索引 |
| 追踪运行状态 | 订阅 `agent/created` / `agent/disposed` / `agent/status` |
| 给模型用的工具 | `ctx.tools.register(...)` 注册 8 个工具 |
| 给其它插件用的 API | `ctx.provide('conversationManager', ...)`，含 `diagnostics()` |
| 状态变化通知 | `ctx.emit('conversation-manager/changed', ...)` |
| 资源清理 | `ctx.effect(...)`；工具与持久化都交出处置器 |
| 会话日志读取 | `session.snapshotEvents()`，并投影出 user / assistant / tool 消息 |
| 对自己做体检 | `conversation_selftest` 把「插件对宿主的假设」与「宿主真实形态」逐条对账 |

索引只保存**元数据与计数**（标题、工作目录、轮次、消息数、工具调用数、token 用量、
存活与运行状态），不复制消息正文——正文始终按需从会话日志读取，避免出现第二份真源。

## 工具清单

| 工具 | 作用 |
| --- | --- |
| `conversation_list` | 列出对话，最近活动在前；支持 `limit` / `query` / `include_cold` |
| `conversation_get` | 单个对话的元数据 + 最近消息 + 事件类型计数 |
| `conversation_history` | 读取对话历史，投影为 user/assistant/tool 消息；可含工具调用与结果 |
| `conversation_search` | 关键字检索标题、工作目录与存活会话的消息正文，命中处给摘录 |
| `conversation_stats` | 汇总：对话数、存活/运行数、轮次、消息数、工具调用、事件数、token 用量 |
| `conversation_label` | 设置管理器侧标题；若宿主提供了持久化改名服务则一并写入，并如实报告走了哪条路 |
| `conversation_fork` | 通过 `ctx.sessions.fork()` 把一个对话在指定事件序号处派生为新会话 |
| `conversation_selftest` | **只读自检**：把「本插件对宿主的所有假设」与「宿主的真实形态」对账，逐条给出结论 |
| `conversation_list_all` | **从磁盘**列出全部对话（不限本进程存活的），含标题、首句话、工作区、大小、是否运行中、磁盘路径 |
| `conversation_delete` | **删除对话**：默认移入回收站（可恢复），`permanent:true` 才真删；必须传 `confirm:true`；拒绝删除运行中的对话 |
| `conversation_restore` | 从回收站原样恢复（默认恢复最新一批）；原位置被占用时跳过而不覆盖 |

每个工具都声明了 `parameters`（JSON Schema）、`output.schema`、`output.render`、
`presentCall`，因此模型调用与 GUI 卡片展示都走 DSH 的标准工具流水线。

## 删除对话（DSH 界面没有的能力）

DSH 的产品设计里只有**归档**，没有删除。但每个对话在磁盘上就是一个目录加一条投影缓存，
所以本插件用文件操作补上了删除，并且刻意做得**可撤销**：

| 位置 | 内容 |
| --- | --- |
| `$DSH_HOME/sessions/<工作区>/<会话id>/session.v4.jsonl.zstd` | 对话正文 |
| `$DSH_HOME/storages/session_projcache/sessions/<会话id>.json` | 标题、cwd、创建时间 |
| `$DSH_HOME/session-trash/<批次>/` | 回收站：`sessions/` 正文 + `projcache/` 缓存 + `MANIFEST.json` |

三条安全底线：

1. **默认是移动而不是粉碎**——`MANIFEST.json` 记着每个对话的原始位置，`conversation_restore`
   可原样搬回；只有显式 `permanent:true` 才真的删除。
2. **必须有 `confirm:true`**——少了这个参数一律拒绝，原目录纹丝不动。
3. **拒绝删除正在运行的对话**——本进程里存活的会话会被列进 `refusedLive` 而不是删掉；
   这也顺带保证了「不可能删掉你正在说话的这个对话」。

回收站与 `sessions` 同级、同卷，所以移动是同卷 `rename`：要么完整、要么没动，
不会出现跨盘复制中断留下的半成品。**客户端列表要重启或重连后才会少掉这些行**
（列表读的是持久化 header，不会盯着目录变化）。

> 给模型的用法：先 `conversation_list_all` 看清单拿到 id 或序号，再
> `conversation_delete({ session_ids: [...], confirm: true })`。
> 用户口述「删掉第 3 个」时，模型应先把清单念一遍确认，再带 `confirm:true` 执行。

## 目录结构

```
dsh-conversation-manager/
├── index.js              # 宿主半入口：name / inject / apply(ctx, config)（纯 JS，无需构建）
├── lib/
│   ├── events.js         # 会话日志读取 + 事件→可读消息投影（纯函数）
│   ├── conversations.js  # 对话索引：登记、增量计数、检索、统计、快照
│   ├── tools.js          # 12 个 ToolDefinition（含删除/恢复/清空）
│   ├── cleanup.js        # 磁盘层面的列出 / 回收站 / 恢复（纯函数）
│   └── trash-mirror.js   # 把回收站概览写进会话工作区（供 Web 面板显示）
├── src/client/           # 浏览器半源码（TypeScript + React）
│   ├── index.tsx         # apply(ctx)：注册页签类型、正文/标题 slot、会话行菜单项、locale
│   ├── manager.tsx       # 「对话管理器」正文组件（跨工作区总表）
│   ├── locale.ts         # 中英文字典 + LocaleNamespaceMap 声明
│   └── styles.ts         # 注入式 CSS（随插件生命周期挂载/移除）
├── dist/                 # 浏览器半构建产物（pnpm run bundle 生成，git 忽略）
│   └── client.js         # window.__ModuleLoader__.load(...) 闭包工厂制品
├── test/smoke.mjs        # 宿主半冒烟测试（伪造 ctx 驱动全流程）
├── scripts/
│   ├── verify-client.mjs # dist/client.js 产物自检（工厂契约 + 平台模块纯度）
│   └── smoke-client.mjs  # 产物契约冒烟测试（真实执行 apply，并用极简渲染器渲染正文组件，66 项断言）
├── tsdown.config.ts      # 自包含的客户端 bundle 构建配置
├── tsconfig.json         # 编辑器/类型检查配置
├── cordis.patch.yml      # 组合包 patch（按包名引用，供 profile 安装用）
├── patch.local.yml       # 开发期 --patch 覆盖层（按绝对路径引用宿主半）
└── package.json          # dsh.bundle（宿主+客户端接线）+ dsh.client（浏览器半声明）
```

## 接入方式

三种方式都先做同一步：**构建浏览器半**（宿主半是纯 JS，不需要构建）。

```sh
cd <plugin-dir>
pnpm install
pnpm run bundle          # 产出 dist/client.js；开发时用 pnpm run watch 持续重建
```

`dist/client.js` 就是 Web 启动内核要加载的那个闭包工厂制品。没构建它，宿主半照常工作，
但 GUI 里不会出现「对话管理器」页签（装载器找不到 `exports['./client']` 指向的文件）。

> **开发机注意**：开发机的 `node` / `pnpm` 都不在 PATH 上（DSH 自带的是内置运行时）。
> 构建时先接上它们；我在一个工具 shim 目录里放了两个 shim 可以直接用：
>
> ```powershell
> $env:PATH = "<工具shim目录>;$env:PATH"   # node.cmd / pnpm.cmd
> cd <本仓库目录>
> pnpm install && pnpm run bundle && pnpm run check:client
> ```
>
> 它们分别指向 `<DSH_HOME>\dsh-runtimes\dsh-primary-runtime\dependencies\` 下的
> Node 24.21.0 与 pnpm 11.7.0。

### 方式一：`--patch` 覆盖层（最快，改完即生效）

```sh
# 在 DSH 源码 checkout 根目录
pnpm dsh web --patch <plugin-dir>/patch.local.yml
```

`patch.local.yml` 里 `name` 就是本目录 `index.js` 的绝对路径。启动后终端会打印：

```
[conversation-manager] 对话管理器已加载：已追踪 N 个对话，工具 conversation_list / ...
```

> 注意一处依据强弱差别：官方 `--patch` 教程里挂载的**源文件是 `.ts`**，而 `.js` 形式只在
> 「组合包」文档里出现过（`export const name` + `export function apply()` 的 `index.js`）。
> 也就是说方式一用 `.js` 大概率可行、但我没有在有依据的文档里见到同样的写法。
> 如果加载器只接受 `.ts` 源路径，把三个源文件复制成 `.ts` 即可——文件内容是纯 JS，
> 本身就是合法 TypeScript，不需要改一行代码。

### 方式二：安装成组合包（可进 profile）

本包声明了 `dsh.bundle`，因此可以按包安装：

```sh
dsh plugin --profile web add <plugin-dir>
dsh --profile web --dump-config     # 期望看到 "# == dsh-conversation-manager" 这一层
dsh --profile web
```

安装后这一行同时带出宿主半与浏览器半：宿主 Loader 装载 `index.js`，
`clientModules` 再从本包 `package.json` 的 `dsh.client` 声明找到 `dist/client.js` 组进 Web 启动图。
所以**先按上面的前置步骤构建一次**；`pnpm install` 在本包目录执行时会经 `prepare` 自动跑 tsdown。

> 若改成从 git 安装（`dsh plugin ... add github:you/dsh-chat-keeper`），
> pnpm ≥10 默认拒绝运行依赖的 `prepare`，第一次 `add` 会失败。按 pnpm 打印的包键，
> 在该 profile 的 `pnpm-workspace.yaml` 里加：
>
> ```yaml
> allowBuilds:
>   dsh-conversation-manager: true
> ```
>
> 这等于**允许该包的代码在你机器上于安装时执行**，只对源码可信的包授权，并锁定 commit。
> 不想授权就改走 tarball：`pnpm pack` 后 `dsh plugin --profile web add ./dsh-conversation-manager-0.2.0.tgz`。

### 方式三：挂进桌面 profile（就是你现在正在用的这个 GUI）

你机器上的 profile 在 `<DSH_HOME>\profiles\desktop\`，它的
`cordis.patch.yml` 是最后生效的用户层。在那里追加一行即可：

```yaml
- insert:
    - id: conversation-manager
      name: '<plugin-dir>/index.js'
```

改完需要重启 DSH（宿主启动时才装配插件树）。这一段写的是工作区之外的系统配置，
属于安装步骤的一部分，按上文「接入方式」操作即可。

## 让它出现在 DSH 的「插件」页面里

**本插件当前不在插件页里**，原因很具体：

- 插件页管的是 profile 的**组合包（bundle）**——即 `dsh.profile.bundles` 列出的包，以及它们贡献的行。
- 本插件当初是通过**手写一行 patch** 装上的（profile 的 `cordis.patch.yml` 里
  `insert: { id: conversation-manager, name: '<绝对路径>' }`）。那只是一个 Loader 行，
  不属于任何组合包，所以插件页看不见它、也管不了它。

**正确装法**（插件页支持绝对路径：它的 `inspect` 会直接读该路径的 `package.json`）：

1. 打开 DSH 右侧栏的**插件**页；
2. 安装，输入本目录绝对路径：`<本仓库目录>`；
3. 装好后**删掉手写的那 4 行 patch**——否则同一个 id 有两行，profile 层的手写行会盖住
   组合包的行，插件页里就会"看着装了却不生效"；
4. 重启 DSH。

本包声明了 `dsh.bundle`，所以会被当作**组合包**（而不是普通依赖）追加进 `dsh.profile.bundles`，
插件页随即能看到它的开关与卸载按钮。本地路径安装是 `link:`，即直接使用这个目录
（因此 `dist/client.js` 必须已经构建）。

## 发布到你自己的 GitHub 仓库

可以。这份代码是在你的机器上、按你的需求写出来的，你有权发布。发布前清单：

- [x] `LICENSE`（MIT）已就位——把里面的 `YOUR-NAME-OR-GITHUB-USER` 换成你的名字或用户名；
- [x] `package.json` 去掉了 `"private": true`，并补上 `keywords` / `repository` / `homepage` /
      `bugs` / `author`——把其中的 `YOUR-GITHUB-USER` 换成你的用户名；
- [x] `.gitignore` 已忽略 `node_modules/`、`dist/`、`*.tgz`；
- [ ] 确认**不要**提交：`node_modules`、`dist`（构建产物，由 `prepare` 生成）、
      任何 `cordis.patch.yml.bak-*` 备份，以及 `$DSH_HOME` 下的**会话数据与回收站**
      （对话正文是你的私人数据，与插件代码无关）；
- [ ] README 里加一句免责声明：这是**第三方社区插件**，与 DeepSeek 官方无关。

两条诚实提醒：

1. 这是**按 DSH 公开的插件 API** 写的插件，不是发明了 DSH 本身。GitHub 上已有其它社区插件
   （例如控制 Windows 音频的 `dsh-audio-control`），所以"首创/唯一"这类说法站不住；
   但**"给 DSH 补上磁盘层面的删除 + 回收站"**这一点我没有在别处见过，是可以主张的。
2. 这份代码是**与 AI 助手协作写成**的（宿主半来自上一次会话，浏览器半与清理工具来自本次会话）。
   法律上通常不成问题；如果你在意署名，可以在 README 注明
   "co-written with an AI assistant"。

参考命令：

```sh
cd <plugin-dir>
git init
git add .
git commit -m "feat: DSH conversation manager (browser panel + disk-level delete with recycle bin)"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-USER/dsh-chat-keeper.git
git push -u origin main
```

## 配置项

`config` 全部有默认值，因此**不传配置也能用**：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `maxTracked` | `500` | 索引最多保留多少条记录，超出后淘汰最久未活动的非存活记录 |
| `titleMax` | `80` | 自动标题的最大字符数（取首条用户消息） |
| `persistPath` | `''`（关闭） | 非空时把索引快照写入该文件，重启后仍能看到历史对话的元数据 |
| `saveDebounceMs` | `1000` | 写盘防抖间隔 |
| `trashMirror` | `true` | 是否把回收站概览写进各存活会话的工作区（`.dsh-conversation-manager/trash.json`），供 Web 面板显示。**镜像只含批次名/时间/条数/大小，不含任何对话正文或标题**；不想让本插件往你的工程目录写文件就设为 `false`（面板会显示"读不到镜像"） |

持久化默认**关闭**：插件不应在用户机器上产生意外写入。开启示例：

```yaml
- insert:
    - id: conversation-manager
      name: '<plugin-dir>/index.js'
      config:
        persistPath: '<DSH_HOME>/conversation-manager/index.json'
```

## 对外服务与事件

其它插件可以消费（消费方需在自己的 `inject` 里声明 `conversationManager`）：

```js
export const inject = ['conversationManager']
export function apply(ctx) {
  ctx.conversationManager.list({ limit: 10 })
  ctx.conversationManager.stats()
  ctx.conversationManager.search('关键词')
  ctx.conversationManager.isLive(sessionId)   // 决定历史能否读到完整内容
  ctx.conversationManager.diagnostics()       // 自检账本
  ctx.on('conversation-manager/changed', (payload) => { /* reason: session-created | ... */ })
}
```

## Web GUI 交互面（客户端半）

浏览器半是一个标准的 DSH 客户端插件包：`package.json` 声明 `dsh.client`（`platform: 'web'` + inject 边），
`exports['./client']` 指向构建产物 `dist/client.js`。宿主 `clientModules` 扫描到这条声明后，
把它组进 Web 启动图；插件在浏览器侧自己的 Cordis 应用里激活。

### 用户看到什么

| 位置 | 形态 |
| --- | --- |
| 对话顶部动作条 | 一枚**「对话管理器」**按钮（最显眼的入口） |
| 右侧 Sidebar | 一个页面类型页签**「对话管理器」**；引导页多一个同名入口 |
| 左侧会话行 `...` 菜单 | 条目**「在对话管理器中定位」**（order 500，落在内置 rename/fork/archive 之后） |

页签正文**只做原生侧栏没有的事**（这是刻意的取舍，见下节）：

- **跨工作区单一总表**：所有工作区的会话挤在一张表里（标题 / 工作区 / 最近活动 + 状态点），
  默认隐藏空白会话与 subagent 来源会话。原生侧栏一次只看一个工作区，没有这个视角。
- **状态与规模一览**：`共 N 个 · M 运行中 · K 已归档`，以及每行的状态点
  （运行中 / 等待交互 / 已完成未读 / 空闲）。
- **按时间批量**：下拉选「7 / 30 / 90 天前的」只保留最近活动早于该时间的会话，
  再配合「全选」即可一次处理一批陈旧对话（清理场景的主力动作）。
- **「显示已归档」开关**：关掉后总表不再列出已归档的行；顶部统计**不跟着隐藏**（仍如实报告
  `K 已归档`），旁边补一枚 `符合条件 N 个` 说明当前可见几条。取值存 `localStorage`
  （键 `dsh-conversation-manager/show-archived`），面板重开后保持。
  **刻意只过滤总表**：搜索结果不跟着过滤——搜到却看不见会被用户当成"搜索坏了"。
- **批量归档 / 取消归档**：勾选任意多行一次提交，逐条执行并汇总失败数。
- **有工作在进行时的归档**：先发普通归档；若 Host 以 `workspace/session-active` 拒绝，
  弹出「停止并归档？」确认，确认后带 `stopActivity: true` 重发（与内置侧栏同一 Host 语义）。
- **回收站一览**：页脚显示 `回收站：N 批` 与最近几批的批次名 / 条数 / 大小（数据来自宿主写在
  工作区里的镜像，见下节），带「刷新」按钮。
- **删除与恢复的入口**：受能力边界限制，这两个动作以「复制精确指令」的方式交付（见下节）。
- **定位**：从会话行菜单进来时，页签读 `navigation.params.focusSessionId`，滚动到该行并高亮约 2 秒。

### 回收站一览是怎么到面板上的（镜像文件）

面板读不到 `$DSH_HOME`，它能读的只有**会话工作区内的文件**。所以宿主半把回收站概览写成一个小文件：

| | |
| --- | --- |
| 位置 | `<会话工作区>/.dsh-conversation-manager/trash.json` |
| 内容 | `{ version, at, trashRoot, count, batches: [{ batch, at, entries, sizeKB, restorable }] }` |
| **不含** | 对话正文、对话标题、会话 id —— 只有批次级统计 |
| 写入时机 | 会话创建时、以及每次删除/恢复之后（给所有存活会话的工作区各刷一份） |
| 关闭方式 | 配置 `trashMirror: false`，插件就不再往工作区写任何文件 |
| 写入方 | 宿主半 `lib/trash-mirror.js` |
| 读取方 | 面板经 `workspaceFiles` Remote 读取（scope = 会话 id，路径 `TRASH_MIRROR_PATH`） |

**读取方为什么要"传一串会话 id"**：`workspaceFiles` 的 scope 必须是会话 id。面板能从标准
prop `useSession` 拿到本次页签的会话 id（**实测可用**：诊断记录里 `hasSessionId: true`），
所以正常情况下**第一次尝试就命中**（`tried: 1`）。传一串候选只是稳健性兜底——镜像是**全局同一份**、
宿主又把它写进了每个存活会话的工作区，因此任意一个能读通的会话都给出同样内容，也不会因为
某个会话没有镜像而整体失败。

读取结果另有一次诊断落盘（`localStorage['dsh-conversation-manager/trash-probe']`，
只记 `ok / tried / code / message / bytes` 等字段，**不含任何会话内容**），外加 6 秒超时兜底。

跨两半的路径常量**无法共享模块**（两半各自打包），因此两处各写一份，并由
`pnpm test` 里的一条断言做交叉验证：宿主声明的 `MIRROR_RELATIVE_PATH` 必须出现在
客户端产物 `dist/client.js` 里——改了宿主常量却忘了客户端会立刻测试失败。

> 为什么不用「投影（`sessionProjections`）」这条路：投影是为**日志派生**状态设计的
> （按事件驱动发布、带 checkpoint），拿它装"磁盘上的目录内容"语义不对，而且会滞后。
> 文件镜像是这里最直白的通道。

### 为什么面板不重复原生（砍掉了什么）

改版时**特意删掉**了这些——因为原生侧栏已经有，做了只是重复：

| 删掉 | 原生在哪 |
| --- | --- |
| ~~搜索（标题 / 正文）~~ | 侧栏顶部搜索框，带 250ms 防抖。**但正文搜索默认是关的**，见下文「0.3.0：把正文搜索真正用起来」——所以 0.3.0 又把它加回面板，并补上高亮与复制 |
| 按工作区筛选、归档三态筛选 | 侧栏「视图选项」 |
| 排序（最近更新 / 标题 / 工作区） | 侧栏「视图选项」的排序模式 |
| 置顶 / 取消置顶 | 会话行 `...` 菜单 |
| 重命名 | 会话行 `...` 菜单（双击标题也行） |
| 分叉 | 会话行 `...` 菜单 |
| 新建会话 | 侧栏与主视图都能建 |

**保留了什么**：**跨工作区总表**、**批量操作**、**删除/恢复入口**，以及 0.3.0 之后的**正文搜索（加强版）**。
所以这个面板的定位一句话说清：**DSH 缺的那部分（盘点 + 清理 + 能用的正文搜索）**，而不是再造一个侧栏。

### 0.3.0：把正文搜索真正用起来（一次完整的追查）

用户反馈"官方只能搜标题、搜不了正文"。查证过程与结论如下——**用户的判断是对的，但原因不是缺功能**：

| 证据 | 位置 | 说明 |
| --- | --- | --- |
| `session-query-sqlite` 的配置是 `openAt: never` + `path: ':memory:'` | `dsh-base/cordis.patch.yml`、`dsh-web-app/cordis.patch.yml` | 全文索引**默认不打开** |
| 官方注释："Full-text session search is opt-in… search calls fail with SESSION_QUERY_SEARCH_DISABLED… **the Web sidebar search matches titles and workspace names only**" | 同上 | 明确写了默认行为 |
| "内容搜索失败时，元数据匹配项仍会显示，**不另给警告**" | `ui-workspace/README.zh.md` | **静默降级** —— 这正是"看起来只能搜标题"的来源 |
| 宿主搜索：`if (provider === undefined) throw …`；结果 `authorized.push({ sessionId, snippet })`；`items: authorized.slice(0, 20)` | `api-session-controller/lib/index.js` | 索引缺失即报错；每条只有 `{sessionId, snippet}`；**服务端硬截断 20 个会话** |
| `searchResultLimit = 20` 只用于客户端截断 | `api-session-controller/lib/client.js` | 所以"显示更多"这条路人做不到（宿主上限在前） |

**结论与做法**：
1. 官方给的开关是"在更靠后的 patch 层把 `openAt` 覆盖成 `first-search`（或 `startup`），通常再给一个持久化路径"；
2. 本插件的组合包 patch 就写了这一行（默认 `:memory:`，不落文件），所以**装了插件就同时获得原生正文搜索**；
3. 面板补上原生没有的三样：**摘要高亮关键词**、**同行的工件区/归档状态**、**一键复制结果清单**；
4. 面板**不承诺"超过 20 条"** —— 那是宿主服务端的硬上限，承诺了就是骗人；
5. 索引没开时面板**如实显示错误码**，而不是像原生那样静默降级成"没有结果"。

**这条经验值得记住**：DSH 里"默认关闭的可选能力"会让功能看起来像"不存在"。
遇到"某个官方功能好像没有"时，先去**组合包 patch** 里看它是被 `never` 关着，还是真的没实现。

### 0.3.1：把索引打开之后，中文子串仍然搜不到（第二层原因）

打开索引后我用 `node:sqlite` 只读打开那份数据库逐个查证，
发现**中文子串仍然搜不到**：

| 查询 | 真实索引结果 |
| --- | --- |
| `"session"` | 命中 ✅ |
| `"conversation_delete"` | 命中 ✅ |
| `"内容检索示例"`（整段中文） | 命中 ✅ |
| `"检索"`（子串，原文是「内容检索示例」） | **0 条** ❌ |

再用临时 FTS5 表做对照实验（不碰真实数据），结论明确：

```
整段中文 "内容检索示例"  → 1
中文子串 "检索"          → 0      ← 问题在这
ASCII   "DSH"             → 1
```

根因：`dsh-session-query-sqlite` 建表用的是 `tokenize = 'unicode61'`（`lib/index.js` 里
`CREATE VIRTUAL TABLE persisted_docs USING fts5(..., tokenize = 'unicode61')`），
而 unicode61 **把一整串连续中文当作一个词元** —— 搜索词只有正好等于某个完整词元段才命中。
查询侧还把调用方文本整体引号成一个 FTS5 phrase（`quoteFtsData`），不带任何通配或前缀扩展，
所以子串检索无从谈起。

**修法（本版）**：不改别人的分词器（那是宿主的事），而是给**工具**加一条独立的路径：
`lib/log-read.js`（逐帧解压会话日志）+ `lib/search-disk.js`（字面子串扫描），
于是 `conversation_search` 变成"索引快路径 + 磁盘全路径"的合并：

- 冷对话也搜得到（索引只覆盖它自己索引过的会话，磁盘路径覆盖全部）；
- 中文子串命中（字面匹配，与分词器无关）；
- 三条刹车：`max_conversations`（默认 60，按最近活动倒序）、`budget_ms`（默认 5 秒）、`limit`；
- 超预算如实回 `diskTimedOut: true`，读不开的日志进 `diskUnreadable`，**不假装"搜完了没有"**。

面板那一侧**做不到**这件事：浏览器半没有读日志的通道（只能走宿主的 Remote），
所以面板搜索受同一个分词器限制。README 里把这一点写明了——**能力边界要写在用户看得见的地方**。

测试覆盖（宿主半 50 → 54）：用 `zstdCompressSync` 造**两帧拼接**的真日志，断言
「整句里搜中文子串能命中」「命中次数正确」「日志路径是目录时进 unreadable 且不影响其它命中」。



### 浏览器半的能力边界（为什么删除是「复制指令」而不是按钮）

删除与恢复是**宿主的磁盘操作**，而浏览器半没有文件访问权。DSH 只允许浏览器半通过
**生成的 Remote 命名空间**与宿主通信；外部插件要声明自己的 Remote，就得依赖内部包
（版本敏感、代价大），这对一个小工具不划算。因此本面板的处理是：

- 面板负责**选择**（勾选框）；
- 「删除所选」把一条**带确切会话 id 的指令**复制进剪贴板，用户粘贴到输入框发送即可，
  由宿主的 `conversation_delete` 工具执行（默认进回收站）；
- 「恢复最近一批」同理复制一条恢复指令。

两个好处：**不会偷偷往你的对话里发消息**；指令里带确切的 id，**不会误删**。
代价是多一次「粘贴发送」。

### 用了哪些「最新插件接入」的契约

- **两段式页签类型**：`ctx.sidebarRightTabs.register({ id, kind, priority: 'extension', title, guide })`
  声明类型（无 `patterns` → 页面类型，由 `openTab(kind)` 打开），正文/标题再分别注册进
  keyed slot `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title`，**key = 定义 id = 包名**。
- **列表 slot 贡献**：`sidebar.workspaces.session.menu.item`，拿到 owner 给的 `{ sessionId, displayTitle }`
  与框架注入的 `useMenuOpenState`，用 ui-primitives 的 `MenuItemButton` 渲染成原生样式的菜单行；
  会话头部按钮用 ui-primitives 的 `Button`，与同一条动作条里的控件外观一致。
- **标准 props 取数**：正文组件完全不接触 `ctx`——会话目录 / 状态 / 工作区分别来自
  `useSessions`、`useSessionStatus`、`useWorkspaces` 三个全局标准 hook。
- **服务与变更**：`ctx.get('workspaces') as IWorkspaces`（批量归档）、`ctx.get('sessions') as ISessions`
  （面板「刷新」→ `sessions.refresh()`）、惰性解析的 `ctx.get('uiWorkspace')`（打开会话）。
- **Remote 命名空间必须单独声明**：读回收站镜像走 `ctx.remote.workspaceFiles.read(...)`，
  而 `inject` 里**只写 `'remote'` 是不够的**——Cordis 会以
  `cannot get property "remote.workspaceFiles" without inject` 拒绝访问。必须按
  `'remote.workspaceFiles'` 的形式把命名空间本身也声明进去（ui-workspace 的
  `'remote.directoryPicker'` 是同一写法）。
- **踩过的坑：抛在 try 外面的异常会伪装成"永远加载中"**。早期版本把
  `ctx.remote.workspaceFiles` 的取用放在 try 之外，于是那句拒绝异常变成未处理的 Promise
  拒绝，`loadTrash` 一次都没更新状态，界面停在初始的"加载中"、点「刷新」也毫无反应——
  **完全没有报错**。所以现在：取用与读取都在 try 内、有 6 秒超时兜底、并把结果写进诊断探针。
  这类"什么都不做"的故障比报错更难查，值得按此处理。
- **生命周期**：样式标签与 locale 字典注册在 `ctx.effect(...)` 里，卸载即回收。
- **bundle 纯度**：运行时只 `import` 平台模块（`react`、`react/jsx-runtime`、
  `@deepseek-ai/dsh-client-ui-primitives`），其余 `@deepseek-ai/*` 一律 `import type`；
  `tsdown.config.ts` 里有一个与仓库同名规则等价的纯度门，把运行时值导入变成构建错误。
- **产物格式**：闭包工厂制品 `window.__ModuleLoader__.load({ id, factory: (require) => { ... } })`，
  与仓库 `packages/client/tsdown.client.ts` 的输出契约一致（该预设无法从安装目录复用，故在此自包含复刻）。

### 明确不做的事

- **面板里没有一步到位的删除按钮**：删除是宿主的磁盘操作，而浏览器半没有文件访问权。
  面板给的是「复制精确指令」，粘贴发送后由宿主的 `conversation_delete` 执行
  （详见上文「浏览器半的能力边界」）。要真做成一步按钮，得给插件加一个自己的
  Remote 命名空间，代价大于收益——但**这是可以升级的**，见「后续可选升级」。
- **确认对话框就地渲染**在页签内，没有占用 `shell.overlay`——代价是不能跨页签浮出，
  换来的是插件自包含：不需要与其它包共享一份视图状态。
- **不持久化任何自有状态**：选择集是页签内的临时状态，刷新即回到默认。

### 后续可选升级（都没做，需要时再说）

1. **一步删除按钮**：给宿主半声明一个 Typert Remote 命名空间（如
   `ctx.remote.conversationMaintenance.delete(...)`），客户端按钮直接调。
   代价：需要依赖 `@deepseek-ai/dsh-typert-*` 等内部包，版本敏感；收益是省掉一次粘贴。
   （一旦有了它，「回收站一览」也可以顺带改成实时推送。）

### 已完成的两项升级

- ~~**面板显示回收站内容**~~ → 已做：宿主写镜像（`.dsh-conversation-manager/trash.json`），
  面板经 `workspaceFiles` 读，页脚显示批次数与最近几批。见「回收站一览是怎么到面板上的」。
- ~~**按时间批量**~~ → 已做：面板顶部的时间下拉（7 / 30 / 90 天前的）+ 全选。
  它是**时间**维度，与原生已有的搜索/工作区筛选/排序不重叠，因此符合"不重复原生"的取舍。

## 中文搜索的兜底（0.5.0）

### 现象与根因（都在本机 app.asar 里核对过）

用户反馈：**英文搜得准，中文时好时坏；官方放大镜和本插件面板一模一样**。

1. **同一条链**：面板 `searchContent` → 客户端 `sessions.search` → `remote.session.search`
   → 宿主 `search(request, signal)` → `listState.search(query, signal)` →
   `provider.searchSessions({ query, eventFilters, limit, cursor })`。
   侧栏（`dsh-client-ui-workspace` 的 `deriveSearchResults` 拿的是 "ranked Host content-search page"）
   也走它 —— **所以只在面板层改，救不了官方放大镜**。
2. **分词器写死**：`dsh-session-query-sqlite/lib/index.js` 里两张表（`persisted_docs` 与
   `temp.live_docs`）的建表语句都带 `tokenize = 'unicode61'`；该包可配置项只有
   `path / openAt / journalMode / defaultLimit`，**没有分词器开关**。
3. **查询被包成字面短语**：`quoteFtsData(query)` → `"${query}"` 送进 MATCH。
   unicode61 把连续字母串当一个词元 → 英文单词天然被空格隔开所以准；
   中文整句连成一片，只有查询词正好等于被标点/英文切出来的那一段时才命中。
4. **DSH 官方自己写明了**（`dsh-session-query-sqlite/README.zh.md`）：
   "结果匹配 token 与短语，而非任意子字符串"；字面子串要用宿主侧
   `ctx.sessionQuery.filterEvents()`（带 `text` 子句，**浏览器半走不到**）；
   并且 "trigram 备选方案经实测后被否决"。
5. **实测对照**（本机，同一批会话）：`对话管理器` → 索引 3 个会话、磁盘 4 个；
   `的根因` → 索引 1、磁盘 3；`搜不到` → 索引 1、磁盘 2 —— **索引侧时中时不中，
   磁盘侧每次都全中**。（"索引何时会命中"的确切边界规则**没有钉死**，不作结论。）

### 为什么选这一层修

| 候选 | 结论 |
| --- | --- |
| 换 tokenizer（trigram） | 否：要改安装包源码（升级即失效）、要重建索引、trigram 要求 ≥3 字符（"检索"这种两字词搜不到）、DSH 官方已实测否决 |
| 插件自建 Typert Remote 命名空间 | 否（本轮不做）：宿主侧可行（`@deepseek-ai/dsh-typert-protocol` 在 npm 上是 0.1.0-rc.6），但客户端描述符生成代码 `import zod`，**不在客户端平台模块白名单**，纯度门会挡 —— 属于"可能做不到" |
| **宿主半包一层 `sessions.search`** | **选它**：只改本插件、客户端一行不动，且官方放大镜与面板一起变好 |
| 面板"复制指令"兜底 | 备选（体验差一步），本轮未做 |

### 实现（`lib/search-cjk.js`）

- `hasCjk()` 判定中日韩文字；**只有含 CJK 的查询才触发**，英文路径逐字不变。
- `installCjkSearch(sessions, …)` 把 `sessions.search` 包一层：先取官方结果，
  再用 `searchConversationsOnDisk()`（与工具同一条字面扫描路）补命中并合并。
- **三条底线**：① 扫描出错只记 warn、原样返回官方结果；② `base.items` 不是数组就
  原样返回（不猜别人的契约）；③ `restore()` 还原（继承来的就 `delete` 自己的属性），
  由 `ctx.effect` 在卸载时调用。
- **错误语义不变**：官方抛错（查询非法、索引关闭、取消）一律原样往外抛 ——
  README 里"索引关闭时如实回传错误码"那条承诺没有被这条兜底破坏。
- 合并规则：官方结果在前（不打乱它的排序与授权过滤）、按 `sessionId` 去重
  （两边都有时保留官方片段，因为它一定含查询词、客户端高亮认得）、
  上限 20（与 `authorized.slice(0, 20)` 一致）、放不下就 `hasMore: true`。
- 8 秒 TTL 缓存：面板与官方放大镜连续搜同一个词时只扫一次磁盘。
- 自检账本新增 `cjkSearch: { installed, reason, calls, cacheHits, added, lastElapsedMs }`
  —— **只有计数，不记录用户搜了什么**。

### 验证到什么程度（诚实标注）

- ✅ 宿主半冒烟 **76 项**（含：装上补丁、英文零扫描、中文子串真的把夹具 `memo-zh-1`
  合并进官方结果、返回形状仍是 `items/hasMore`、缓存只扫一次、官方抛错原样外抛、
  扫描失败不外溢、卸载还原原方法）。
- ✅ 语法检查、客户端 66 项、产物契约全绿（本轮**没动浏览器半**，`dist/` 未变）。
- ⏳ **未真机验收**：补丁要 DSH **重启**后才装上。真机上需要确认两件事：
  ① `conversation_selftest` 的 `cjkSearch.installed` 是否为 `true`；
  ② 官方放大镜里搜一个中文子串，是否出现原来搜不到的会话。

## 验证

### 0. 实机结果（已在这台机器上跑过）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 宿主半语法 | `pnpm run check` | **通过**（exit 0） |
| 宿主半冒烟 | `pnpm test` | **全部通过：76 项检查**（含中文搜索兜底） |
| 客户端产物契约 | `pnpm run verify:client` | **通过**（工厂头尾 + 平台模块纯度） |
| 客户端契约冒烟 | `pnpm run smoke:client` | **66/66 项通过**（含「显示已归档」开关的面板渲染断言） |
| 实机挂载（宿主半） | `conversation_selftest` | **8 个工具已注册、跟踪 6 个真实会话、事件实时到达** |
| 实机界面（浏览器半） | 你按 F5 后的目视确认 | ⏳ 待你确认 |

> 首次运行时 `pnpm test` 有 1 项失败：那条断言要求「冷记录重见存活会话时补出 `usage`」，
> 但没开 `deepScan`——而本插件的设计是**默认不调用已弃用的 `snapshotEvents()`**，
> 所以拿不到 usage。这是测试期望写错（与同一套件里「默认路径完全不触碰 `snapshotEvents()`」
> 那条自相矛盾），已改为分别断言默认路径与 `deepScan: true` 路径。

### 1. 语法与逻辑（不需要 DSH）

```sh
cd <plugin-dir>
node --check index.js && node --check lib/events.js && node --check lib/conversations.js && node --check lib/tools.js && node --check lib/cleanup.js && node --check lib/trash-mirror.js
node test/smoke.mjs
```

`test/smoke.mjs` 用一个伪造的 Cordis 上下文驱动真实代码路径，覆盖：

- 插件契约（`name` / `inject` / `apply` / 服务暴露）；
- 生命周期事件 → 对话索引（标题、计数、token 用量、运行状态）；
- 八个工具的实际输出，以及错误分支（未知 id / 缺参 / 会话销毁后历史不可读）；
- **硬加载失败回归**：`sessions.list()` 返回 Promise 时，插件仍必须加载成功并记下 `notes`；
- **持久化闭环**：落盘 → 换一个全新 harness 用同一文件恢复（含 `live/running` 重置）→
  恢复后的记录重见存活会话时按默认路径补齐计数，且**不碰弃用读法**；
  再单独验证 `deepScan: true` 时才补出 usage；
- **卸载即回收**：卸载后工具表必须清空（「注册即可逆效果」这条契约的伪宿主侧验证）。

预期最后一行是 `全部通过：42 项检查`。

> 注意上面最后一条的局限：伪造 `ctx.effect` / `ctx.tools.register` 的**返回值语义本身就是我的假设**，
> 所以它验证的是「插件正确使用了这两个返回值」，而不是「宿主真的这么定义」。

### 2. 真实挂载

**本机实际用的方式**（已在运行中的桌面实例里生效，且不需要重启应用）：

```yaml
# <DSH_HOME>\profiles\desktop\cordis.patch.yml 末尾
- insert:
    - id: conversation-manager
      name: '<plugin-dir>/index.js'
```

桌面版的插件树是**热装载**的：改完这份 patch 后，宿主半立刻生效（`conversation_*` 工具随即出现），
客户端扫描器也随 `internal/plugin` 事件增量重组 Web 启动图，所以浏览器半**只需刷新页面**。

其他两种等价方式：

```sh
# 开发期：源码 checkout 里用覆盖层
pnpm dsh web --patch <plugin-dir>/patch.local.yml

# 或装成组合包（可进 profile 的 bundles 列表）
dsh plugin --profile web add <plugin-dir>
```

> 注意：`dsh --profile desktop --dump-config` 会报
> "profile \"desktop\" is managed exclusively by the Electron application"——
> 桌面 profile 不能由 CLI 直接 dump，验证要在活着的应用里做（见第 3 节）。

挂载后，在会话里让模型调用 `conversation_stats` 或 `conversation_list`，
应当返回当前进程里真实存在的会话。

### 3. 挂载后的第一步：让模型调用 `conversation_selftest`

因为这份代码是在**无法执行任何命令**的环境里写的，所以我把「验证」做成了一个工具。
挂载成功后调用一次 `conversation_selftest`，它会返回：

- `services`：`injected` 里哪些服务真的存在、`ctx.sessions` 的 `list/get/fork` 各是不是函数、
  `sessionController` 上有哪些方法；
- `services.managerExposedVia`：服务到底是通过 `provide` 还是 `set` 暴露的（还是 `failed`）；
- `tracking.handlersFired`：六个生命周期监听器各被触发过几次；
- `tracking.distinctEventTypes` + `sampleEvents`：**真实观测到的事件类型**，以及每种类型第一份样本的
  顶层键与 `data` 键——用来核对我对事件负载形状的假设；
- `liveSessionSamples`：每个存活会话有没有 `snapshotEvents()`、它返回数组还是 Promise、事件条数；
- `findings`：把上面这些直接翻译成「哪条假设成立、哪条不成立」的自然语言结论。

如果 `findings` 说「所有已检查的假设都成立」，那么历史读取、事件追踪、服务暴露这三条主链路
在开发机上就是被验证过的；反之它会明确指出是哪一条不成立。

### 4. 构建并验证客户端半

```sh
cd <plugin-dir>
pnpm install
pnpm run bundle
```

构建成功的三个可核对特征：

1. `dist/client.js` 存在，且**首行**是闭包工厂注册：
   `window.__ModuleLoader__.load({ id: "dsh-conversation-manager", factory: (require) => {`
   末行是 `return module.exports; } });`
2. **产物纯度自检**（不需要 DSH、不需要浏览器，只要 node）：

   ```sh
   pnpm run verify:client
   ```

   它检查三件事：工厂注册头/尾是否符合 `window.__ModuleLoader__.load({ id, factory })` 契约、
   bundle 里所有 `require(...)` 是否都在平台模块白名单内（`react`、`react/jsx-runtime`、
   `@deepseek-ai/dsh-client-ui-primitives` 等），以及有没有把 React 实现内联进来。
   出现白名单之外的 `@deepseek-ai/*` 说明纯度门被绕过，bundle 里会多出一份运行时实例。
3. 挂载后刷新页面，右侧 Sidebar 的引导页里应出现「对话管理器」入口；点进去能看到会话总表。
   终端会打印 `dsh-conversation-manager: ...` 相关的 effect 标签（若该版本打印 effect 日志）。

> 客户端半改了代码后要重新 `pnpm run bundle`（或让 `pnpm run watch` 常驻）。
> 已安装的组合包不会自动重建；HMR 只在源码 checkout 且 `pnpm run dev:web` 常驻时才接管。

## 诚实清单：验证到什么程度

我（写这个插件的 agent）当时所处的环境**无法执行任何命令**（沙箱权限故障），
所以下面把「有依据」和「没验证」分清楚：

**已依据官方文档确认**
- 插件契约：`name` / `inject` / `apply(ctx, config)`，注册即自动清理，见[插件与生命周期](https://deepseek-harness.github.io/deepseek-harness/develop/framework/index.md)。
- 服务与依赖：`inject` 保证顺序、`ctx.get()` 探测可选服务、`ctx.provide/set` 属于继承的 cordis API，见[服务与依赖](https://deepseek-harness.github.io/deepseek-harness/develop/framework/service.md)与[Inherited Cordis API](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-api/inherited.md)。
- 事件签名：`session/created`、`session/disposed`、`session/event`、`agent/created`、`agent/disposed`、`agent/status`，见[core 子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/core.md)与[会话子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session.md)。
- **SessionEvent 的类型词表与负载形状**：`SessionEventMap` 的生成类型块给出了 `turn/start`、`user/message`、
  `assistant/message`（含 `message` / `usage` / `interrupted`）、`tool/call`（`callId`/`name`/`arguments`）、
  `tool/result`（`message.isError`）等全部成员；`lib/events.js` 的 `KNOWN_EVENT_TYPES` 与投影逐一对齐这张表。
- **消息与内容块**（[llm-streaming](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/llm-streaming.md)）：
  一条消息的 `content` 就是 `ContentBlock[]`；标签集合是 `text`/`reasoning`/`image`/`file`/`tool-call`/
  `tool-addition`/`tool-removal`；**`reasoning` 块的内容在 `thinking` 字段里**（不可见推理，本插件不进摘要），
  工具结果是 `ToolResultMessage`（`toolCallId`/`content`/`isError`）。`MessageSource.kind` 确认是判别标签。
- **`TokenUsage` 的字段与汇总规则**：`inputTokens`/`outputTokens` 必有，`totalTokens`/`cacheReadTokens`/
  `cacheWriteTokens`/`reasoningTokens` 可选；**各计数互不重叠**，计费输入 = 前三者之和，而
  `reasoningTokens` **已经含在 `outputTokens` 里、汇总不得再加**。因此本插件只做逐字段求和，
  并单独给出 `billableInputTokens`，不提供任何「把字段加起来」的总量。
- `SessionHeader.cwd`（由生成签名 `Pick<SessionHeader, 'cwd'>` 佐证）与 `ctx.sessions.fork(source, boundary?, childSessionId?)`、`snapshotEvents()`。
- `ToolDefinition` 的字段（`parameters` / `output.schema` / `output.render` / `execute` / `presentCall`）与强制的 JSON Schema 子集；面向模型的 `ToolSchema` 只有 `name`/`description`/`parameters`，`parameters` 是 JSON Schema 对象——本插件手写的定义正是按这两层写的，见[工具子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/tools.md)。
- 加载顺序与 `--patch` / 组合包两种接入，见[打包与安装插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish.md)。

**尚未在真实宿主上跑过（需要你在本机执行）**

首先是最重要的一条：

- `node test/smoke.mjs` 与 `pnpm dsh web --patch ...` 我**没有执行过**：本会话的命令执行被沙箱故障挡住
  （`sandbox-local windows-acl temp grant materialization failed`），我无权运行 node/pnpm。
  冒烟测试的结论是**人工推演**的，不是实测。

还有一个贯穿全部条目的前提：上面那些文档描述的是**文档对应的那个版本**。无法读到目标机器上
实际的构建产物（源码在 `app.asar` 归档里，`read` 工具能进归档但会撞上内部缺陷 `Cannot mix BigInt and
other types`），所以「文档这么说」与「你的构建这么做」之间的差距，就是下面这些条目的全部风险。

以下每一条都是代码强依赖、但**只有文档依据、没有实测**的宿主细节。错了通常不会抛错，
而是表现为「计数为 0 / 标题为空 / running 恒为 false」这类静默症状——`conversation_selftest`
的存在就是为了把这些症状一次性变成可见结论：

1. **`session/event` 的参数顺序**是 `(session, event)`——整个索引都押在这一条上。
2. **agent 事件载荷形状**：`payload.agent.id`、`payload.agent.session`、`payload.status`，
   以及 `status === 'running'` 这个词表。另外 **agent id 与 session id 是否相同**我无法确认，
   所以代码里两者都解析、优先用 session 自己的 id 建键。
3. **`ctx.effect(fn)` 的语义**是「fn 的返回值作为卸载时的处置器」。注意：冒烟测试的伪造 `effect`
   恰好把这一假设写死了，所以**测试通过不能证明这条契约成立**（同义反复），必须真机确认。
4. **`ctx.tools.register(def)` 返回 disposer**；**数组根 `output.schema`**（`conversation_search` 用
   `{ type: 'array' }`）是否合法；**`presentCall` 返回 `{ card: 'generic', title, kind }`** 的形状。
5. **`ctx.sessions.list()` 同步返回数组**——若不是数组（尤其返回 Promise），插件在加载期就会
   跳过会话补登记；这条已加**回归测试**（不会让插件崩掉，但会记一条 `notes`）。
6. **`ctx.sessions.fork(Session对象, boundary)` 接受 Session 对象**，且返回对象至少带 `.id`；
   否则 `conversation_fork` 报 `forked: false` 而不是崩掉。
7. **`snapshotEvents()` 是同步还是异步**：工具的读历史路径用异步（两种都能吃），但索引的同步
   全量统计（`backfill`）吃不到 Promise，遇到这种情况 `conversation_selftest` 会明确指出来。
8. **`ctx.provide('conversationManager', service)`**：文档只说明 `provide/set` 属于「低层服务存储
   访问」，**签名是我按 `(key, value)` 推断的**；失败会退到 `ctx.set`，再失败只打一条警告。
9. **`sessionController.rename` 的请求字段名**：我用的是 `{ sessionId, title }`，来自文档描述而非
   类型定义。这条分支是「尽力尝试 + 失败降级为管理器侧标题」，结果里用 `durable: true/false`
   如实报告。该服务在**调用时**才解析，因此不会被 apply 时机影响。
10. **自定义事件 `conversation-manager/changed`** 没有类型声明（声明需要 import cordis 类型），
    发出时包在 `try/catch` 里；若你的构建对未声明事件直接抛错，最多是收不到这个通知。
11. **`node --check` 对 `.js` 里的 ESM 是否通过**取决于 Node 是否依 `package.json` 的
    `"type": "module"` 采用 ESM 目标；`node test/smoke.mjs` 本身会 import 这三个文件，
    是更可靠的真语法检查。

**客户端半（浏览器半）的证据等级——与宿主半分开看**

**已构建，并已对照本机安装的 0.2.0-rc.2 运行时逐条核对**（不是只看文档，是把
`app.asar` 里的实际发布产物抽出来读的；`user-actions` 与 `typert.host.js` 里还带着生成的完整接口声明）：

- bundle 产物契约与官方模板一致：`@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/`
  的 `client.js` 就是同样形状的 `window.__ModuleLoader__.load({ id: <包名>, factory(require) })`；
- 平台模块白名单：`packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES`
  （产物实测只 `require` 了 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`，
  且**没有任何内置客户端插件**在 `dsh.client.inject` 里列 ui-primitives / ui-slots——它们是平台内置，不需要列）；
- 服务名：`ctx.reflect.provide("sidebarRightTabs", …)`、`provide("sidebarRight", …)`、
  `super(ctx, "uiWorkspace")` —— 与我的 `inject` 列表逐字一致；
- 页签定义：`tab-registry.js` 的 `SidebarRightTabDefinition`、`priority` 三档、
  `guide: [{ id, order, title, description }]` 数组形状（与内置 Browser 页签的写法对照）；
- keyed 注册：内置 GuideBody 就是 `ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name, key }, …))`
  ——**在 apply 顶层裸调用**，我也照此写；
- 标准道具：内置 `WorkspaceBrowser({ …, useSessions, useSessionStatus, useWorkspaces, … })`；
  `useWorkspaces((state) => state)` 与 `useSessionStatus((s) => s)` 都是 **selector hook**，与我的用法一致；
- `const { tab } = useTabInfo()`（内置 GuideTitle 的写法）+ `tab.navigation.revision`；
- `const [, setMenuOpen] = useMenuOpenState()` 与
  `MenuItemButton({ children, separatorBefore, onSelect })` —— 与内置四个行菜单项完全一致；
- 服务方法：`sessions.search/fork/using/refresh`、`workspaces.archiveSession(sessionId, options)/
  unarchiveSession/pinSession/unpinSession/list` 全部逐字核对；
- 数据结构：`SessionSummary` 行 `{ id, displayTitle, running, blank, updatedAt, title?, cwd?, parentId?, origin? }`
  与 `WorkspaceView { workspaceId, path, title, sessionIds, createdAt, updatedAt }` 逐字段吻合；
- locale：`ctx.locale.register(ns, dicts)` 与 `ctx.locale.bind(ns)`（返回 `(key, params) => …`）；
- 接入链路：扫描器对 Loader 行向上找最近 `package.json`、对未知 inject 包名跳过而非报错、
  bundle 路由无目录限制、增量重扫由 `internal/plugin` 事件触发。

**仍未验证**

- **界面渲染效果没有经过机器验证**：产物能加载、`apply` 能跑、注册内容正确（
  `pnpm run smoke:client` 共 33 项断言全绿），但**页面长什么样只能由你在真实 GUI 里看**。
  按官方 `references/verification.md` 的指引，我没有去伪造页面或截图来替代这一步
  （并明确不把它当作界面已验证）。
- **`tsc` 会满屏 TS2307**：本包 `devDependencies` 只有 cordis / react / tsdown，
  tsconfig 也没有 DSH 私有包的类型映射，所以 `pnpm exec tsc --noEmit` 必然报「找不到模块」。
  这**不影响构建**（tsdown 只转译、不做类型检查）。
- **JSX 转换方式**：tsdown/Rolldown 对 `.tsx` 的默认转换是 **automatic**（[tsdown 文档](https://tsdown.dev/zh-CN/recipes/react-support)
  明写 classic 才需要显式配置），因此产物 import 的是 `react/jsx-runtime`——它正是平台模块表成员，
  不需要额外配置。**若将来这个默认值改了**，`tsdown.config.ts` 里要显式补上 automatic，
  否则会退化成 classic 的 `React.createElement`，而 bundle 里没有 React 实现 → 加载即报错。
- **`tsc` 会满屏 TS2307**：本包的 `devDependencies` 只有 cordis / react / tsdown，
  tsconfig 里也没有（也不该有）DSH 私有包的类型依赖，所以 `pnpm exec tsc --noEmit`
  必然报「找不到模块 '@deepseek-ai/dsh-*'」。这**不影响构建**（tsdown 不做类型检查）。
  想要完整类型检查，就把相关的 `@deepseek-ai/dsh-*` 装成 devDependencies 并在 tsconfig 里配好解析。
- 两处**声明合并**的落地效果：`SessionReferenceSourceMap` 按仓库惯例合并到
  `@deepseek-ai/dsh-api-session-controller/client`；而 `SidebarRightTabParamsMap`
  我**故意没有合并**，改为把 `openTab` 的 params 收在一个窄适配类型里——
  这样无论你的版本是否接受该合并，代码都能通过类型检查，代价是参数类型偏松。
- `dist/client.js` 的真实产物我无从查看，所以 README「验证」一节里的
  `pnpm run verify:client` 就是让你用一条命令确认纯度门确实生效。

## 为什么手写 ToolDefinition 而不用 `defineTool`

最后一条设计取舍：手写 `ToolDefinition`（没有用 `defineTool`）意味着**参数校验由本插件自己负责**
（见 `lib/tools.js` 的 `coerce*`）。之所以这么写：插件位于 harness 源码树之外时，
Node 的裸模块解析到不了 `@deepseek-ai/*`，任何顶层 import 都会让插件加载失败。

## 早期岔路（已废弃）

本仓库之前有过一个独立的 `dialog-manager/` Node 程序，它自定义了一套
`processMessage` / `plugins/` 约定，和 DSH 的插件体系没有关系（DSH 不认识它，
也从未加载过它），且代码本身有语法错误。本目录是它的**替代品**，不是它的延续；
那份实验已经废弃，不再维护。
