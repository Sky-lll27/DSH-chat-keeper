/**
 * 直接读磁盘上的会话日志（含**冷对话**）。
 *
 * 为什么需要单独的读取器：`lib/events.js` 的读取都接的是**存活会话对象**
 * （`session.snapshotEvents()` / `deriveMessages()`），冷对话没有对象可给。
 * 而"搜索任意对话的正文"必须能读冷对话——这正是 DSH 自带内容索引之外的价值：
 *
 *   1. 自带索引走 SQLite FTS5 的 `unicode61` 分词器，它把**一整串连续中文当一个词元**，
 *      所以中文子串（例如在「内容检索示例」里搜「检索」）搜不到；
 *   2. 本模块做的是**字面子串**匹配，与语言无关，中文子串照样命中。
 *
 * 日志格式：`session.v4.jsonl.zstd` 是**多个 zstd 帧按追加顺序拼接**的 JSONL——
 * 每次追加写一个新帧，因此必须逐帧解压（对整文件调一次解压只能得到第一帧）。
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

/** zstd 帧魔数（小端 0x28 0xB5 0x2F 0xFD）。 */
const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 找出所有可能的帧起点（魔数出现处）。 */
function frameOffsets(buffer) {
  const offsets = []
  let from = 0
  for (;;) {
    const at = buffer.indexOf(FRAME_MAGIC, from)
    if (at < 0) break
    offsets.push(at)
    from = at + FRAME_MAGIC.length
  }
  return offsets
}

/**
 * 逐帧解压一个会话日志，返回事件数组。
 *
 * 边界猜测失败时的兜底：魔数也可能出现在压缩数据内部，所以某一段解不开就
 * 退化为"从这个起点一直解到文件末尾"，仍然失败就跳过这个假起点。
 *
 * @param file - `session.v4.jsonl.zstd` 的绝对路径
 * @param options - `{ maxEvents }`：读够这么多事件就停（用于给搜索设上限）
 * @returns `{ events, frames, bytes, truncated }`；读失败时抛出（调用方决定是否跳过）
 */
export function readEventsFromFile(file, options = {}) {
  const buffer = readFileSync(file)
  const offsets = frameOffsets(buffer)
  const chunks = []
  let consumed = 0
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index]
    if (start < consumed) continue
    const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length
    try {
      chunks.push(zstdDecompressSync(buffer.subarray(start, end)).toString('utf8'))
      consumed = end
    } catch {
      try {
        chunks.push(zstdDecompressSync(buffer.subarray(start)).toString('utf8'))
        consumed = buffer.length
      } catch {
        // 假起点：跳过
      }
    }
  }

  const text = chunks.join('')
  const events = []
  const maxEvents = typeof options.maxEvents === 'number' && options.maxEvents > 0
    ? options.maxEvents
    : Number.POSITIVE_INFINITY
  let lines = 0
  for (const line of text.split('\n')) {
    if (line === '') continue
    lines += 1
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const event = parsed?.event ?? parsed
    if (event === null || typeof event !== 'object') continue
    events.push(event)
    if (events.length >= maxEvents) break
  }
  return { events, frames: chunks.length, bytes: buffer.length, lines, truncated: events.length >= maxEvents }
}

/**
 * 从一条事件里取出用于搜索/展示的正文文本。
 * 只取文本块，跳过图片等非文本内容——与"字面搜索"的语义保持一致。
 */
export function eventText(event) {
  const type = typeof event?.type === 'string' ? event.type : ''
  if (type !== 'user/message' && type !== 'assistant/message') return undefined
  const data = event?.data ?? {}
  const content = Array.isArray(data.content)
    ? data.content
    : Array.isArray(data.message?.content)
      ? data.message.content
      : []
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  const text = parts.join('\n').trim()
  return text === '' ? undefined : text
}
