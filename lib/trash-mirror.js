/**
 * 回收站镜像：把「回收站里有什么」写成一个极小的 JSON，放进**会话工作区**里。
 *
 * 为什么需要它：浏览器半读不到 DSH_HOME，它能读的只有**会话工作区内的文件**
 * （`workspaceFiles` Remote，按 sessionId 授权）。所以面板要显示回收站内容，
 * 宿主必须把清单放到工作区里。
 *
 * 三条自律：
 *   1. 只写**批次概览**（批次名、时间、条数、大小），**绝不写对话正文或标题**；
 *   2. 放在隐藏目录 `.dsh-conversation-manager/` 下，避免污染工作区根；
 *   3. 可由配置 `trashMirror: false` 整体关闭（不往用户工程里写任何东西）。
 *
 * 对应的客户端常量在 `src/client/manager.tsx`（两半是各自打包的，无法共享模块，
 * 因此路径在两处各写一份，注释互相指认）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listTrashBatches, trashRoot } from './cleanup.js'

/** 镜像所在目录（相对会话工作区根）。 */
export const MIRROR_DIR = '.dsh-conversation-manager'
/** 镜像文件名。 */
export const MIRROR_FILE = 'trash.json'
/** 相对路径的规范拼写（客户端按这个路径读取）。 */
export const MIRROR_RELATIVE_PATH = `${MIRROR_DIR}/${MIRROR_FILE}`

/**
 * 构造镜像内容：回收站批次概览。
 * @param dshHome - `$DSH_HOME`
 */
export function buildTrashMirror(dshHome) {
  const batches = listTrashBatches(dshHome)
  return {
    version: 1,
    at: new Date().toISOString(),
    trashRoot: trashRoot(dshHome),
    count: batches.length,
    batches: batches.slice(0, 10).map(entry => ({
      batch: entry.batch,
      at: entry.at,
      entries: entry.entries,
      sizeKB: entry.sizeKB,
      restorable: entry.restorable,
    })),
  }
}

/** 把镜像写进一个工作区根。 */
function writeInto(cwd, payload) {
  const dir = join(cwd, MIRROR_DIR)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, MIRROR_FILE)
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  return file
}

/**
 * 给一组工作区根刷新镜像。
 * @param dshHome - `$DSH_HOME`
 * @param cwds - 会话工作区根（重复项会自动去重）
 * @returns `{ written, failed, payload }`；单个工作区写失败不影响其它。
 */
export function refreshTrashMirrors(dshHome, cwds) {
  const payload = buildTrashMirror(dshHome)
  const written = []
  const failed = []
  for (const cwd of new Set((cwds ?? []).filter(c => typeof c === 'string' && c !== ''))) {
    try {
      written.push(writeInto(cwd, payload))
    } catch (error) {
      failed.push({ cwd, error: String(error?.message ?? error) })
    }
  }
  return { written, failed, payload }
}
