/**
 * 本地化字典与命名空间。
 * 按 ui-workspace 的打包约定：用户可见文案全部放在贡献包自己的 locale 命名空间里，
 * 组件通过注册项的 locale 声明拿到 `t`。这里声明 LocaleNamespaceMap 的合并入口，
 * 使 `PropsLocale<typeof NS>` 能推导出所有消息键。
 */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'dsh-conversation-manager'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-conversation-manager':
      | 'title'
      | 'guideTitle'
      | 'guideDescription'
      | 'locateInManager'
      | 'statsLine'
      | 'selectAll'
      | 'selectedCount'
      | 'archive'
      | 'unarchive'
      | 'deleteSelected'
      | 'restore'
      | 'clearSelection'
      | 'refresh'
      | 'filterAll'
      | 'filterOlder7'
      | 'filterOlder30'
      | 'filterOlder90'
      | 'filteredCount'
      | 'timeFilterHint'
      | 'trashTitle'
      | 'trashEmpty'
      | 'trashUnavailable'
      | 'trashNoSession'
      | 'listRefreshed'
      | 'batchLine'
      | 'colTitle'
      | 'colWorkspace'
      | 'colUpdated'
      | 'archivedBadge'
      | 'ungrouped'
      | 'empty'
      | 'loading'
      | 'statusRunning'
      | 'statusPending'
      | 'statusDone'
      | 'statusIdle'
      | 'justNow'
      | 'minutesAgo'
      | 'hoursAgo'
      | 'daysAgo'
      | 'stopArchiveTitle'
      | 'stopArchiveBody'
      | 'stopAndArchive'
      | 'cancel'
      | 'runningWork'
      | 'archivedToast'
      | 'unarchivedToast'
      | 'batchFailedToast'
      | 'actionFailedToast'
      | 'hostOnlyHint'
      | 'pasteHint'
      | 'copiedDeleteHint'
      | 'copiedRestoreHint'
      | 'searchPlaceholder'
      | 'searchHint'
      | 'searchClear'
      | 'searchHits'
      | 'searchMore'
      | 'searchNoHits'
      | 'searchFailed'
      | 'searchDisabledHint'
      | 'searchCopy'
      | 'copiedHitsHint'
      | 'searchJumpHint'
      | 'copyFailed'
  }
}

export const en: LocaleDictOf<typeof NS> = {
  title: 'Conversation Manager',
  guideTitle: 'Conversation Manager',
  guideDescription: 'Every conversation across workspaces in one list: batch archive, and delete (recoverable).',
  locateInManager: 'Locate in manager',
  statsLine: '{count} conversations · {running} running · {archived} archived',
  selectAll: 'Select all',
  selectedCount: '{count} selected',
  archive: 'Archive',
  unarchive: 'Unarchive',
  deleteSelected: 'Delete selected',
  restore: 'Restore last batch',
  clearSelection: 'Clear',
  refresh: 'Refresh',
  filterAll: 'All time',
  filterOlder7: 'Older than 7 days',
  filterOlder30: 'Older than 30 days',
  filterOlder90: 'Older than 90 days',
  filteredCount: '{count} matching',
  timeFilterHint: 'Keep only conversations whose last activity is older than this',
  trashTitle: 'Recycle bin: {count} batch(es)',
  trashEmpty: 'Recycle bin: empty',
  trashUnavailable: 'Recycle bin: mirror unreadable ({message})',
  trashNoSession: 'this tab has no session context',
  listRefreshed: 'List refreshed — deleted conversations are gone from the sidebar.',
  batchLine: '{batch} · {count} item(s) · {size} KB',
  colTitle: 'Title',
  colWorkspace: 'Workspace',
  colUpdated: 'Last activity',
  archivedBadge: 'archived',
  ungrouped: 'Ungrouped',
  empty: 'No conversations yet',
  loading: 'Loading…',
  statusRunning: 'Running',
  statusPending: 'Waiting for interaction',
  statusDone: 'Finished, unread',
  statusIdle: 'Idle',
  justNow: 'just now',
  minutesAgo: '{n}m ago',
  hoursAgo: '{n}h ago',
  daysAgo: '{n}d ago',
  stopArchiveTitle: 'Stop and archive?',
  stopArchiveBody: '{count} conversation(s) still have work running; archiving stops it first.',
  stopAndArchive: 'Stop and archive',
  cancel: 'Cancel',
  runningWork: 'Still running: {activity}',
  archivedToast: 'Archived',
  unarchivedToast: 'Unarchived',
  batchFailedToast: '{count} failed',
  actionFailedToast: 'Failed: {message}',
  hostOnlyHint: 'Delete and restore are disk operations only the host can perform, so this panel copies an exact instruction instead of acting directly.',
  pasteHint: 'Paste it into the input box and send.',
  copiedDeleteHint: 'Copied the delete instruction for {count} conversation(s).',
  copiedRestoreHint: 'Copied the restore instruction.',
  searchPlaceholder: 'Search conversation text…',
  searchHint: 'Search conversation bodies through the DSH content index (the index must be enabled).',
  searchClear: 'Clear',
  searchHits: '{count} conversation(s) matched',
  searchMore: 'More matches exist — try a more specific phrase',
  searchNoHits: 'No matching conversation',
  searchFailed: 'Search failed: {message}',
  searchDisabledHint: 'DSH full-text search is opt-in (the bundles ship openAt: never). This plugin\'s bundle patch turns it on; you can also override session-query-sqlite\'s openAt in the profile cordis.patch.yml.',
  searchCopy: 'Copy results',
  copiedHitsHint: 'Copied {count} search result(s).',
  searchJumpHint: 'DSH has no event deep link: selecting a result only opens the conversation, never the matched message. To read the original text around a hit, ask in chat — "search for X and show the surrounding messages" — the tool locates the exact event (seq) and returns that context.',
  purgeBin: 'Empty recycle bin',
  purgeHint: 'Permanently erases every batch — this cannot be undone.',
  copiedPurgeHint: 'Copied the instruction to permanently erase {count} batch(es).',
  copyFailed: 'Could not access the clipboard — select the text manually.',
}

export const zh: LocaleDictOf<typeof NS> = {
  title: '对话管理器',
  guideTitle: '对话管理器',
  guideDescription: '跨工作区的对话总表：批量归档，以及删除（可恢复）。',
  locateInManager: '在对话管理器中定位',
  statsLine: '共 {count} 个会话 · {running} 运行中 · {archived} 已归档',
  selectAll: '全选',
  selectedCount: '已选 {count} 项',
  archive: '归档',
  unarchive: '取消归档',
  deleteSelected: '删除所选',
  restore: '恢复最近一批',
  clearSelection: '清除',
  refresh: '刷新',
  filterAll: '全部时间',
  filterOlder7: '7 天前的',
  filterOlder30: '30 天前的',
  filterOlder90: '90 天前的',
  filteredCount: '符合条件 {count} 个',
  timeFilterHint: '只保留最近活动早于该时间的会话',
  trashTitle: '回收站：{count} 批',
  trashEmpty: '回收站：空',
  trashUnavailable: '回收站：读不到镜像（{message}）',
  trashNoSession: '当前页签没有会话上下文',
  listRefreshed: '列表已刷新——删掉的对话已从侧栏消失。',
  batchLine: '{batch} · {count} 个 · {size} KB',
  colTitle: '标题',
  colWorkspace: '工作区',
  colUpdated: '最近活动',
  archivedBadge: '已归档',
  ungrouped: '未分组',
  empty: '暂无会话',
  loading: '加载中…',
  statusRunning: '运行中',
  statusPending: '等待交互',
  statusDone: '已完成未读',
  statusIdle: '空闲',
  justNow: '刚刚',
  minutesAgo: '{n} 分钟前',
  hoursAgo: '{n} 小时前',
  daysAgo: '{n} 天前',
  stopArchiveTitle: '停止并归档？',
  stopArchiveBody: '{count} 个会话仍有工作在进行；归档会先停止它们。',
  stopAndArchive: '停止并归档',
  cancel: '取消',
  runningWork: '仍有工作：{activity}',
  archivedToast: '已归档',
  unarchivedToast: '已取消归档',
  batchFailedToast: '{count} 项失败',
  actionFailedToast: '操作失败：{message}',
  hostOnlyHint: '删除与恢复是磁盘操作，只有宿主能做：本面板给出的是精确指令，复制后粘贴发送即可。',
  pasteHint: '粘贴到输入框发送。',
  copiedDeleteHint: '已复制 {count} 个对话的删除指令。',
  copiedRestoreHint: '已复制恢复指令。',
  searchPlaceholder: '搜索对话正文…',
  searchHint: '搜索对话正文（走 DSH 的内容索引；索引需要已打开）',
  searchClear: '清除',
  searchHits: '命中 {count} 个对话',
  searchMore: '还有更多命中，建议用更具体的关键词',
  searchNoHits: '没有匹配的对话',
  searchFailed: '搜索失败：{message}',
  searchDisabledHint: 'DSH 的全文索引默认关闭（组合包给的是 openAt: never）。本插件的组合包 patch 会打开它；也可以在 profile 的 cordis.patch.yml 里自行覆盖 session-query-sqlite 的 openAt。',
  searchCopy: '复制结果',
  copiedHitsHint: '已复制 {count} 条搜索结果。',
  searchJumpHint: 'DSH 没有「跳到某条消息」的接口——点结果只会打开会话，到不了那一句。想看原句上下文：在对话里说「帮我搜『X』并读出上下文」，工具会定位到确切位置（seq）并返回前后原文。',
  purgeBin: '清空回收站',
  purgeHint: '永久删除全部批次——不可恢复。',
  copiedPurgeHint: '已复制清空指令（{count} 批，永久删除、不可恢复）。',
  copyFailed: '无法访问剪贴板，请手动选择文本。',
}
