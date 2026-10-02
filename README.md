# DSH-chat-keeper

[![CI](https://github.com/Sky-lll27/DSH-chat-keeper/actions/workflows/ci.yml/badge.svg)](https://github.com/Sky-lll27/DSH-chat-keeper/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> **仓库名**：`DSH-chat-keeper`（原 `DSH-conversation-manager`，旧地址会自动跳转）。
> **包名**：仍是 `dsh-conversation-manager` —— npm 包名必须全小写，而且已安装的用户是靠包名关联的，
> 改包名会让他们失联，所以仓库名与包名在这里故意不一致。

一个真正接入 **DeepSeek Harness（DSH）** 插件体系的对话管家。它补齐了 DSH 界面缺失的那部分：
**跨工作区盘点**、**正文搜索**、**批量处理**，以及 DSH 本身没有的 —— **删除对话（回收站式，可恢复）**。

其中搜索是最常被问到的：DSH 的正文索引**默认是关的**（组合包给的是 `openAt: never`），
打开后中文又只认"整段"。本插件替你打开索引，并额外提供一条**读磁盘**的通道 ——
中文子串能搜、**没打开过的旧对话也能搜**、还能**定位到命中那句并把前后文读出来**。

> 第三方社区插件，与 DeepSeek 官方无关。代码由作者与 AI 助手协作完成，
> 详见文末「关于作者与 AI 协作」一节。

## 它解决什么问题

DSH 自带的侧栏已经能搜索、置顶、改名、分叉、归档 —— 这些本插件**刻意都不重复**。
它只做四件侧栏给不了（或默认给不了）的事：

| 能力 | 为什么只有它能做 |
| --- | --- |
| **跨工作区单一总表** | 侧栏一次只看一个工作区；"我到底有多少对话、哪些是垃圾"需要一个扁平视角 |
| **批量处理 + 按时间筛选** | 侧栏只能一条条点；这里可勾选任意多行批量归档，或用「7/30/90 天前的」筛出陈旧对话一次处理；再用「显示已归档」开关把已归档的对话从总表里收起来 |
| **真删除（可恢复）** | **DSH 只有归档，没有删除。** 本插件在磁盘层面删除，并保留回收站与恢复 |
| **正文搜索（可用 + 加强）** | DSH 的正文搜索是**默认关闭**的 opt-in 能力（组合包给的是 `openAt: never`），此时侧栏只匹配标题与工作区名。本插件的组合包 patch 把它打开，并在面板里补上关键词高亮、工作区列与"复制结果清单" —— 详见下文「搜索对话正文」 |

## 组成

| 半 | 文件 | 作用 |
| --- | --- | --- |
| **宿主半** | `index.js` + `lib/` | 12 个模型可调用工具、会话索引、`conversationManager` 服务（纯 JS，无需构建） |
| **浏览器半** | `src/client/` → `dist/client.js` | Web GUI 的「对话管理器」页签 + 会话行菜单项（TypeScript + React） |

## 安装

### 方式一：从 GitHub 装（推荐给"我只是想用"）

在 DSH 的**插件**页面里安装本仓库地址：

```
https://github.com/Sky-lll27/DSH-chat-keeper
```

或在命令行：

```sh
dsh plugin --profile <你的 profile> add https://github.com/Sky-lll27/DSH-chat-keeper
```

装好后**重启 DSH**（宿主插件树在启动时装配）。

> **不需要构建**：浏览器半的产物（`dist/client.js`）随仓库一起提供。
> 这一点是刻意的——pnpm 11 会拦住 git 依赖的**安装期**构建脚本
> （`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），要么让使用者去批准构建，要么干脆不构建。
> 所以本项目把产物入库，构建只在 `prepack`（打包发布）与手动 `pnpm run bundle` 时发生；
> CI 会校验"提交的产物 == 重新构建的产物"，防止两边漂移。

### 方式二：从本地目录装

在插件页面里安装本目录的**绝对路径**（例如 `<本仓库目录>`）。
同样是 `link:`，同样不需要构建（产物已在仓库里）。

本包声明了 `dsh.bundle`，因此会被当作**组合包**（而不是普通依赖）追加进
`dsh.profile.bundles`，插件页随即能看到它的开关与卸载按钮。

### 方式三：开发期用 `--patch` 直接挂载

```sh
cd /path/to/this/repo && pnpm install && pnpm run bundle
pnpm dsh web --patch /path/to/this/repo/patch.local.yml
```

适合边改边验：不需要安装成组合包。**改了浏览器半的代码记得 `pnpm run bundle`**。

### 卸载

在插件页点卸载；或从 profile 的 `package.json` 里移除 `dependencies` 与
`dsh.profile.bundles` 中的本包，再 `pnpm install`。

## 使用

页签正文是一张**跨工作区的会话总表**：

- **顶部**：正文搜索框、`共 N 个 · M 运行中 · K 已归档`、时间筛选下拉（全部 / 7 / 30 / 90 天前的）、**「显示已归档」开关**、全选。
- **「显示已归档」开关**（默认打开，与历史行为一致）：关掉后**总表里不再列出已归档的对话**，
  顶部统计仍如实报告归档数，旁边补一个`符合条件 N 个`说明当前可见几条。
  选择写进 `localStorage`，面板重开后保持。
  两条边界：**只管总表**——搜索结果不受它限制（搜到什么就显示什么，否则会被当成"搜索坏了"）；
  关掉期间无法从总表批量「取消归档」，需要时把开关再打开即可。
- **表格**：勾选框、状态点（运行中 / 等待交互 / 已完成未读 / 空闲）、标题、工作区、最近活动。
  点击标题可打开该对话。
- **勾选后**出现批量条：`归档` / `取消归档` / `删除所选` / `清除`。
  归档自己就能完成；若某行仍有工作在进行，会先弹出「停止并归档？」确认。
- **搜索时**：表格被命中的对话替换（每条带工作区、状态与**高亮摘要**），可一键复制结果清单。
- **底部**：回收站一览（批次数、批次名、条数、大小）与「刷新」。

### 搜索对话正文

搜索有两条路，能力不一样——**先说清楚各自的边界**（都经真机实测）：

| | DSH 原生侧栏搜索 | 本插件**面板**搜索 | 本插件**工具**搜索（`conversation_search`） |
| --- | --- | --- | --- |
| 匹配标题 / 工作区名 | ✅ 立即 | 表格里直接看 | ✅ |
| 匹配**对话正文** | ✅ **但默认是关的**（见下） | ✅ 走同一个索引 | ✅ **而且读磁盘，冷对话也能搜** |
| **中文子串**（如在一整句里搜「检索」） | ❌ 分词器所限 | ❌ 同一个分词器 | ✅ **字面子串，中文无障碍** |
| 结果条数 | 最多 **20 个会话**（宿主服务端就截到 20） | 同一上限，**不承诺更多** | 默认 10（可调到 50），扫描范围另受时间预算约束 |
| 摘要片段 / 高亮 | 有片段、无高亮 | ✅ 片段 **+ 关键词高亮** | ✅ 片段 + 命中次数 |
| 复制结果清单 | ❌ | ✅ | ❌（结果直接回给模型） |

**① 为什么"正文搜索默认是关的"**：`dsh-base` 与 `dsh-web-app` 两个组合包都把内容索引
`session-query-sqlite` 设成 `openAt: never`。此时 `ctx.sessionQuery` 虽然挂着，但一调用搜索就
失败，界面**静默退化成只匹配标题与工作区名**（官方文档原话："内容搜索失败时，元数据匹配项
仍会显示，不另给警告"）—— 所以"搜不到正文"的体验，真实原因是**索引没打开**，而不是缺功能。
本插件的组合包 patch 替你把它打开（`openAt: first-search`，默认内存索引不落文件）。

**② 为什么中文子串要靠工具那条路**：这个索引建在 SQLite FTS5 上，分词器是 `unicode61`，
它**把一整串连续中文当成一个词元**。实测（同一份索引）：

| 查询 | 结果 |
| --- | --- |
| `session`（英文） | ✅ 命中 |
| `"内容检索示例"`（整段中文） | ✅ 命中 |
| `"检索"`（中文**子串**，原文是「内容检索示例」） | ❌ 0 条 |

所以中文只有在"查询词正好等于一个完整词元段"时才搜得到。**工具的磁盘搜索不受这个限制**：
它直接读会话日志（多帧 zstd 逐帧解压）做**字面子串**匹配 —— 中文子串、英文片段都能命中，
而且**冷对话（未装载的会话）也在范围内**。用法就是跟模型说：

> 「帮我搜含『某个关键词』的对话」

工具自带三道刹车：最多读 `max_conversations` 个对话（默认 60，按最近活动倒序）、
时间预算 `budget_ms`（默认 5 秒）、结果上限 `limit`。超出预算时结果里会**如实标注
`diskTimedOut`**，而不是假装"搜完了没有"。

> 想要持久化索引（重启后不必重建）就把组合包 patch 里那行的 `path` 从 `:memory:` 改成真实路径，
> 例如 `$DSH_HOME/storages/session-search.db`；它只是派生数据，随时可删、删了会自动重建。

### 关于删除：为什么是"复制指令"

删除与恢复是**宿主的磁盘操作**，而浏览器半没有文件访问权。DSH 只允许浏览器半通过
**生成的 Remote 命名空间**与宿主通信；外部插件要声明自己的 Remote 需依赖内部包，代价不小。
因此面板负责**选择**，「删除所选」把一条**带确切会话 id 的指令**复制到剪贴板，
粘贴到输入框发送即可，由宿主的 `conversation_delete` 执行。

这样做的两个好处：**不会偷偷往你的对话里发消息**；指令带确切 id，**不会误删**。

### 刷新：让原生侧栏立刻少掉已删的行

删除发生在磁盘上，宿主不会为此推事件，客户端**只在重连时**重拉会话列表 ——
所以删完之后原生侧栏里的行会一直留着，直到重连或重启。
面板的「刷新」调用 `sessions.refresh()` **重新拉取列表基线**，顺手也重读回收站；
打开面板时也会自动重拉一次。所以：**删完点一下「刷新」就够了，不必重启。**

## 模型可调用的工具

宿主半注册 12 个工具，随对话直接被模型调用：

| 工具 | 作用 |
| --- | --- |
| `conversation_list` | 列出对话（最近活动在前），支持条数 / 关键字 / 是否含冷会话 |
| `conversation_get` | 单个对话的元数据 + 最近消息 + 事件类型计数 |
| `conversation_history` | 把对话历史投影为 user/assistant/tool 消息，可含工具调用与结果 |
| `conversation_search` | **字面子串**检索标题、工作目录与**所有对话的正文**（含冷对话，直接读磁盘日志），中文子串也能命中；返回摘录、命中次数与扫描诊断 |
| `conversation_stats` | 汇总对话数、存活/运行数、轮次、消息数、工具调用、事件数、token 用量 |
| `conversation_label` | 设置管理器侧标题；宿主有持久化改名服务时一并写入并如实报告走了哪条路 |
| `conversation_fork` | 在指定事件序号处派生新会话 |
| `conversation_selftest` | **只读自检**：把本插件对宿主的所有假设与宿主真实形态逐条对账 |
| `conversation_list_all` | **从磁盘**列出全部对话（含未装载的），带标题、首句话、工作区、大小、磁盘路径 |
| `conversation_delete` | **删除**：默认进回收站（可恢复），`permanent:true` 才真删；必须 `confirm:true` |
| `conversation_restore` | 从回收站原样恢复（默认最新一批）；原位置被占用时跳过而不覆盖 |
| `conversation_purge` | **清空回收站**：永久删除批次（`all:true` 清全部，或 `batch:"<批次名>"` 删一批），必须 `confirm:true`。**不可恢复** |

## 删除的三条安全底线

| 底线 | 行为 |
| --- | --- |
| **默认是移动而不是粉碎** | 进 `$DSH_HOME/session-trash/<批次>/`，`MANIFEST.json` 记着每条对话的原始位置，`conversation_restore` 可原样搬回 |
| **必须显式确认** | 少了 `confirm:true` 一律拒绝，原目录纹丝不动 |
| **拒绝删除正在运行的对话** | 本进程存活的会话会被列进 `refusedLive` 而不是删掉（也意味着不可能删掉你正在说话的那个） |
| **清空回收站是独立的、不可恢复的一步** | `conversation_purge` 同样要求 `confirm:true`，只接受回收站里实际存在的批次名（并对最终路径做包含性校验，不会被 `..` 带出回收站） |

回收站与 `sessions` 同级、同卷，所以移动是同卷 `rename`：要么完整、要么没动。

**回收站怎么清空**：面板底部有「清空回收站」（同样以"复制指令"方式交付），
或直接对模型说「清空回收站」。`conversation_purge` 清完之后，连空的回收站目录也会一并收掉；
恢复完一个批次后，那个只剩清单的空壳批次也会自动消失，不会在面板里显示成一个"空批次"。

被删对话涉及的两处磁盘位置：

| 位置 | 内容 |
| --- | --- |
| `$DSH_HOME/sessions/<工作区>/<会话id>/session.v4.jsonl.zstd` | 对话正文 |
| `$DSH_HOME/storages/session_projcache/sessions/<会话id>.json` | 标题、cwd、创建时间 |

## 配置

`config` 全部有默认值，不传也能用：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `maxTracked` | `500` | 索引最多保留多少条记录 |
| `titleMax` | `80` | 自动标题的最大字符数 |
| `persistPath` | `''`（关闭） | 非空时把索引快照写入该文件，重启后仍能看到历史对话元数据 |
| `saveDebounceMs` | `1000` | 写盘防抖间隔 |
| `trashMirror` | `true` | 是否把**回收站概览**写进各存活会话的工作区（`<工作区>/.dsh-conversation-manager/trash.json`），供面板显示。镜像**只含批次名/时间/条数/大小，不含正文或标题**；设为 `false` 则不往你的工程目录写任何文件 |

```yaml
- insert:
    - id: conversation-manager
      name: 'dsh-conversation-manager'
      config:
        trashMirror: true
```

## 目录结构

```
index.js                 宿主插件入口（会话索引 + 事件追踪 + 工具注册 + 服务）
lib/
  conversations.js       对话索引：登记、增量计数、检索、统计、快照
  events.js              会话事件 → 消息投影（含多帧 zstd 日志读取）
  tools.js               12 个 ToolDefinition
  cleanup.js             磁盘层面的列出 / 回收站 / 恢复（纯函数）
  trash-mirror.js        把回收站概览写进会话工作区（供 Web 面板显示）
src/client/              浏览器半（TypeScript + React）
  index.tsx              页签类型、三个 slot 注册、inject face
  manager.tsx            总表面板
  locale.ts              中英字典
  styles.ts              主题自适应样式
dist/client.js           浏览器半产物（**提交进仓库**，所以安装时无需构建）
scripts/                 产物契约校验与冒烟（verify-client / smoke-client）
test/smoke.mjs           宿主半冒烟（伪造 Cordis 上下文，无需 DSH）
docs/ENGINEERING-NOTES.md 工程笔记：契约核对、实测数据、踩过的坑
```

## 开发与验证

不需要 DSH 也能跑测试：

```sh
pnpm install
pnpm run check          # 语法检查
pnpm test               # 宿主半冒烟：50 项
pnpm run bundle         # 构建浏览器半（改了 src/client/ 才需要）
pnpm run check:client   # 产物契约 + 纯度门 + 冒烟：43 项
pnpm run check:dist     # 重新构建后检查产物与提交的一致（CI 会跑）
```

其中三条值得一提的断言：

- **纯度门**：浏览器半的产物只能依赖平台模块表里的东西（`react`、`react/jsx-runtime`、
  `@deepseek-ai/dsh-client-ui-*` 等）；任何其它 `@deepseek-ai/*` 的**运行时**值导入都会
  让构建失败（类型导入请用 `import type`）。
- **跨两半一致性**：回收站镜像的路径常量在宿主半与浏览器半各有一份（两半各自打包，
  无法共享模块），测试会断言宿主声明的路径确实出现在客户端产物里。
- **产物不许漂移**：`dist/client.js` 是入库的构建物，`pnpm run check:dist` 会重新构建一次
  并要求工作区无差异——改了源码忘了重新构建，CI 就会失败。

## 已知限制

- 面板里没有"一步到位"的删除按钮（见上文"关于删除"）。要做成一步按钮，需要给插件加一个
  自己的 Typert Remote 命名空间，代价大于收益 —— 这属于可选的后续升级。
- 回收站一览依赖宿主写在工作区里的镜像文件；把 `trashMirror` 设为 `false` 后，面板会显示
  "读不到镜像"，此时用 `conversation_list_all` / `conversation_restore` 工具照常工作。
- 删除后原生列表需要一次「刷新」/重连/重启才会少掉那些行（原因见上文）。

## 常见问题

**Windows 上安装报"没有写入权限" / `EPERM: operation not permitted, symlink ...`？**

这不是文件权限坏了，而是 **Windows 默认不允许普通用户创建符号链接**（只有管理员、或开启了
「开发者模式」才行）。pnpm 在导入包时偶尔需要建一个真正的符号链接（跨盘时不能用目录联接
代替），就会被系统拒绝，DSH 把它归类为"permission"失败。

两种解法：

1. **开启开发者模式**：Windows 设置 → 系统 → 开发者选项 → 打开「开发人员模式」。
   之后重新安装即可（这也是 Node/pnpm 在 Windows 上这类 EPERM 的标准解法）。
2. **改用本地目录安装**（不经过包导入）：把仓库克隆到本地，在插件页里填**目录的绝对路径**
   （`link:` 形式，用目录联接实现，不需要符号链接权限）。本项目就是这么在自己机器上装的。

顺带一提：如果链接目标所在仓库里存在 `node_modules`（例如开发者刚跑过 `pnpm install`），
这个导入步骤更容易踩到它——消费者从 git 安装时不存在这个问题。

**另外两个实测踩到的坑（Windows 上从 git 安装时）**

- **不要用 `git+https://…` 这种带前缀的写法**：pnpm 会把 GitHub 的 `git+https` 地址规范化成 ssh
  （`git+ssh://git@github.com/…`），没配 SSH 密钥就会失败（`git ls-remote ... exit 128`）。
  用**不带前缀的普通 https 地址**即可：
  `https://github.com/Sky-lll27/DSH-chat-keeper.git`
- **已经用本地目录装过、想改成 git 版时，先卸载再装**：本地目录安装是 `link:`
  （Windows 上是目录联接 junction），pnpm 试图"原地改名替换"会被系统拒绝
  （`EPERM ... rename ... _tmp_… -> dsh-conversation-manager`）。
  先在插件页卸载（或 `pnpm remove` 掉那条依赖），再装 git 版。
  顺手提示：拆目录联接要用 `rmdir`（只删联接本身），**不要**用递归删除，否则会连带删掉目标目录里的文件。

## 关于作者与 AI 协作

本项目的**需求、设计取舍、验收与发布由作者（Sky-lll27）决定**；**代码由作者与 AI 助手
（DSH 内的编码代理）协作写成**：宿主半与浏览器半的实现、测试与文档均在 AI 协助下完成，
作者负责提出需求、在真机上逐项验证（实测数据见
[docs/ENGINEERING-NOTES.md](docs/ENGINEERING-NOTES.md)）并对外发布。

这一点在提交记录里用 `Assisted-by:` trailer 标出——这是开源界对 AI 参与的通行做法
（比 `Co-authored-by:` 更准确：AI 不是合作作者）。可参考
[Flux 的 AI 贡献政策](https://github.com/fluxcd/flux2/discussions/5848) 与
[ASF 生成式工具指引的落地讨论](https://issues.apache.org/jira/browse/CALCITE-7752)。

需要说明的是：**GitHub 不会为普通仓库自动添加"AI 生成"标记**（那是它自家 Copilot 流程里的
机制），所以这类声明只能由作者自行写明。

## 许可

[MIT](LICENSE)
