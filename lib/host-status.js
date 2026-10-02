/**
 * 宿主状态快照：把「插件在真实宿主里装上了什么」写成一个小 JSON 放进会话工作区。
 *
 * 为什么需要它（0.5.0 的教训）：宿主半的 `ctx.logger` 不落盘，"补丁装没装上"过去
 * 只有模型在对话里调 `conversation_selftest` 才看得到 —— 于是 0.5.0 把补丁包在了
 * 一个**根本没有 `search`** 的服务上，本地测试全绿、真机却是空的，直到用户搜中文
 * 搜不到才发现。现在把自检账本落成文件，任何人（或任何脚本）都能直接读到
 * 真实宿主里的安装结果，验收不必再依赖"模型愿意调一次工具"。
 *
 * 三条自律（与回收站镜像完全一致）：
 *   1. 只写**版本号与计数、目标状态**，**绝不写对话正文、标题或用户输入**；
 *   2. 放在同一个隐藏目录 `.dsh-conversation-manager/` 下，不污染工作区根；
 *   3. 受配置控制：`trashMirror: false`（一个字节都不往工作区写）或
 *      `statusFile: false`（只关这一份快照）都能关掉它。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MIRROR_DIR } from './trash-mirror.js'

/** 状态快照文件名（与回收站镜像同目录）。 */
export const STATUS_FILE = 'status.json'
/** 相对会话工作区根的规范拼写。 */
export const STATUS_RELATIVE_PATH = `${MIRROR_DIR}/${STATUS_FILE}`

/**
 * 构造快照内容：包一层版本与时间戳。
 *
 * @param {object} payload 由调用方给出（插件版本、自检账本等）；本函数不读任何会话数据
 * @returns {object}
 */
export function buildHostStatus(payload) {
  return {
    schema: 1,
    at: new Date().toISOString(),
    ...(payload && typeof payload === 'object' ? payload : {}),
  }
}

/**
 * 给一组工作区根写状态快照。
 *
 * @param {string[]} cwds 会话工作区根（重复项自动去重，空值跳过）
 * @param {object} payload 快照内容
 * @returns `{ written, failed }`；单个工作区写失败不影响其它，也不向外抛
 */
export function refreshHostStatus(cwds, payload) {
  const body = JSON.stringify(buildHostStatus(payload), null, 2)
  const written = []
  const failed = []
  for (const cwd of new Set((cwds ?? []).filter((value) => typeof value === 'string' && value !== ''))) {
    try {
      const dir = join(cwd, MIRROR_DIR)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, STATUS_FILE)
      writeFileSync(file, body, 'utf8')
      written.push(file)
    } catch (error) {
      failed.push({ cwd, error: String(error?.message ?? error) })
    }
  }
  return { written, failed }
}
