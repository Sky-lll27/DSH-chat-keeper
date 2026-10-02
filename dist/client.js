window.__ModuleLoader__.load({
	id: "dsh-conversation-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locale.ts
		const NS = "dsh-conversation-manager";
		const en = {
			title: "Conversation Manager",
			guideTitle: "Conversation Manager",
			guideDescription: "Every conversation across workspaces in one list: batch archive, and delete (recoverable).",
			locateInManager: "Locate in manager",
			statsLine: "{count} conversations · {running} running · {archived} archived",
			selectAll: "Select all",
			selectedCount: "{count} selected",
			archive: "Archive",
			unarchive: "Unarchive",
			deleteSelected: "Delete selected",
			restore: "Restore last batch",
			clearSelection: "Clear",
			refresh: "Refresh",
			filterAll: "All time",
			filterOlder7: "Older than 7 days",
			filterOlder30: "Older than 30 days",
			filterOlder90: "Older than 90 days",
			filteredCount: "{count} matching",
			timeFilterHint: "Keep only conversations whose last activity is older than this",
			showArchived: "Show archived",
			showArchivedHint: "Applies to the table below only — search results always show every match, archived or not.",
			trashTitle: "Recycle bin: {count} batch(es)",
			trashEmpty: "Recycle bin: empty",
			trashUnavailable: "Recycle bin: mirror unreadable ({message})",
			trashNoSession: "this tab has no session context",
			listRefreshed: "List refreshed — deleted conversations are gone from the sidebar.",
			batchLine: "{batch} · {count} item(s) · {size} KB",
			colTitle: "Title",
			colWorkspace: "Workspace",
			colUpdated: "Last activity",
			archivedBadge: "archived",
			ungrouped: "Ungrouped",
			empty: "No conversations yet",
			loading: "Loading…",
			statusRunning: "Running",
			statusPending: "Waiting for interaction",
			statusDone: "Finished, unread",
			statusIdle: "Idle",
			justNow: "just now",
			minutesAgo: "{n}m ago",
			hoursAgo: "{n}h ago",
			daysAgo: "{n}d ago",
			stopArchiveTitle: "Stop and archive?",
			stopArchiveBody: "{count} conversation(s) still have work running; archiving stops it first.",
			stopAndArchive: "Stop and archive",
			cancel: "Cancel",
			runningWork: "Still running: {activity}",
			archivedToast: "Archived",
			unarchivedToast: "Unarchived",
			batchFailedToast: "{count} failed",
			actionFailedToast: "Failed: {message}",
			hostOnlyHint: "Delete and restore are disk operations only the host can perform, so this panel copies an exact instruction instead of acting directly.",
			pasteHint: "Paste it into the input box and send.",
			copiedDeleteHint: "Copied the delete instruction for {count} conversation(s).",
			copiedRestoreHint: "Copied the restore instruction.",
			searchPlaceholder: "Search conversation text…",
			searchHint: "Search conversation bodies through the DSH content index (the index must be enabled).",
			searchClear: "Clear",
			searchHits: "{count} conversation(s) matched",
			searchMore: "More matches exist — try a more specific phrase",
			searchNoHits: "No matching conversation",
			searchFailed: "Search failed: {message}",
			searchDisabledHint: "DSH full-text search is opt-in (the bundles ship openAt: never). This plugin's bundle patch turns it on; you can also override session-query-sqlite's openAt in the profile cordis.patch.yml.",
			searchCopy: "Copy results",
			copiedHitsHint: "Copied {count} search result(s).",
			searchJumpHint: "DSH has no event deep link: selecting a result only opens the conversation, never the matched message. To read the original text around a hit, ask in chat — \"search for X and show the surrounding messages\" — the tool locates the exact event (seq) and returns that context.",
			purgeBin: "Empty recycle bin",
			purgeHint: "Permanently erases every batch — this cannot be undone.",
			copiedPurgeHint: "Copied the instruction to permanently erase {count} batch(es).",
			copyFailed: "Could not access the clipboard — select the text manually."
		};
		const zh = {
			title: "对话管理器",
			guideTitle: "对话管理器",
			guideDescription: "跨工作区的对话总表：批量归档，以及删除（可恢复）。",
			locateInManager: "在对话管理器中定位",
			statsLine: "共 {count} 个会话 · {running} 运行中 · {archived} 已归档",
			selectAll: "全选",
			selectedCount: "已选 {count} 项",
			archive: "归档",
			unarchive: "取消归档",
			deleteSelected: "删除所选",
			restore: "恢复最近一批",
			clearSelection: "清除",
			refresh: "刷新",
			filterAll: "全部时间",
			filterOlder7: "7 天前的",
			filterOlder30: "30 天前的",
			filterOlder90: "90 天前的",
			filteredCount: "符合条件 {count} 个",
			timeFilterHint: "只保留最近活动早于该时间的会话",
			showArchived: "显示已归档",
			showArchivedHint: "只作用于下方总表；搜索结果不受它限制（搜到什么就显示什么）。",
			trashTitle: "回收站：{count} 批",
			trashEmpty: "回收站：空",
			trashUnavailable: "回收站：读不到镜像（{message}）",
			trashNoSession: "当前页签没有会话上下文",
			listRefreshed: "列表已刷新——删掉的对话已从侧栏消失。",
			batchLine: "{batch} · {count} 个 · {size} KB",
			colTitle: "标题",
			colWorkspace: "工作区",
			colUpdated: "最近活动",
			archivedBadge: "已归档",
			ungrouped: "未分组",
			empty: "暂无会话",
			loading: "加载中…",
			statusRunning: "运行中",
			statusPending: "等待交互",
			statusDone: "已完成未读",
			statusIdle: "空闲",
			justNow: "刚刚",
			minutesAgo: "{n} 分钟前",
			hoursAgo: "{n} 小时前",
			daysAgo: "{n} 天前",
			stopArchiveTitle: "停止并归档？",
			stopArchiveBody: "{count} 个会话仍有工作在进行；归档会先停止它们。",
			stopAndArchive: "停止并归档",
			cancel: "取消",
			runningWork: "仍有工作：{activity}",
			archivedToast: "已归档",
			unarchivedToast: "已取消归档",
			batchFailedToast: "{count} 项失败",
			actionFailedToast: "操作失败：{message}",
			hostOnlyHint: "删除与恢复是磁盘操作，只有宿主能做：本面板给出的是精确指令，复制后粘贴发送即可。",
			pasteHint: "粘贴到输入框发送。",
			copiedDeleteHint: "已复制 {count} 个对话的删除指令。",
			copiedRestoreHint: "已复制恢复指令。",
			searchPlaceholder: "搜索对话正文…",
			searchHint: "搜索对话正文（走 DSH 的内容索引；索引需要已打开）",
			searchClear: "清除",
			searchHits: "命中 {count} 个对话",
			searchMore: "还有更多命中，建议用更具体的关键词",
			searchNoHits: "没有匹配的对话",
			searchFailed: "搜索失败：{message}",
			searchDisabledHint: "DSH 的全文索引默认关闭（组合包给的是 openAt: never）。本插件的组合包 patch 会打开它；也可以在 profile 的 cordis.patch.yml 里自行覆盖 session-query-sqlite 的 openAt。",
			searchCopy: "复制结果",
			copiedHitsHint: "已复制 {count} 条搜索结果。",
			searchJumpHint: "DSH 没有「跳到某条消息」的接口——点结果只会打开会话，到不了那一句。想看原句上下文：在对话里说「帮我搜『X』并读出上下文」，工具会定位到确切位置（seq）并返回前后原文。",
			purgeBin: "清空回收站",
			purgeHint: "永久删除全部批次——不可恢复。",
			copiedPurgeHint: "已复制清空指令（{count} 批，永久删除、不可恢复）。",
			copyFailed: "无法访问剪贴板，请手动选择文本。"
		};
		//#endregion
		//#region src/client/styles.ts
		/**
		* 样式注入。
		*
		* 独立打包的 client bundle 没有仓库那种 CSS 虚拟模块（lightningcss 内联），
		* 所以这里用一段模块级 CSS 文本，配合 install/remove 交给 ctx.effect 生命周期管理——
		* 与仓库内 styleInjectionModule 的注入方式一致（带 data-plugin-css 标签，可去重）。
		*
		* 配色一律不写死亮/暗主题：
		* 容器内文本继承 Sidebar 的 `color`，边框、hover、选中态用 `color-mix` 从 currentColor 派生；
		* 需要实心表面的两处（确认对话框、提示条）用系统色 `Canvas` / `CanvasText`，
		* 由浏览器按当前主题解析；只有状态点的语义色（运行/等待/完成）是固定色，两种主题下都可读。
		*/
		const STYLE_TAG_ID = "dsh-conversation-manager/client.css";
		const CSS = `
.dshm-root {
  display: flex;
  flex-direction: column;
  position: relative;
  height: 100%;
  min-height: 0;
  color: inherit;
  font-size: 13px;
  line-height: 1.4;
}
.dshm-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.dshm-toolbar__row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.dshm-search {
  flex: 1 1 160px;
  min-width: 120px;
}
.dshm-input,
.dshm-select {
  box-sizing: border-box;
  width: 100%;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, currentColor 5%, transparent);
  color: inherit;
  font: inherit;
  outline: none;
}
.dshm-input:focus,
.dshm-select:focus {
  border-color: color-mix(in srgb, currentColor 45%, transparent);
}
.dshm-select {
  width: auto;
  cursor: pointer;
}
/* 正文搜索框：占满一行，与工具条里其它控件同高。 */
.dshm-search {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, currentColor 5%, transparent);
  color: inherit;
  font: inherit;
  outline: none;
}
.dshm-search:focus {
  border-color: color-mix(in srgb, currentColor 45%, transparent);
}
.dshm-toolbar__row--pad {
  padding: 6px 12px;
}
/* 命中列表：每条是一个可点按钮（点击打开该对话）。 */
.dshm-hits {
  margin: 0;
  padding: 0;
  list-style: none;
}
.dshm-hit {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshm-hit:hover {
  background: color-mix(in srgb, currentColor 6%, transparent);
}
.dshm-hit__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.dshm-hit__title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshm-hit__meta {
  flex: 0 0 auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: color-mix(in srgb, currentColor 60%, transparent);
}
.dshm-hit__snippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 16px;
  font-size: 12px;
  line-height: 17px;
  color: color-mix(in srgb, currentColor 70%, transparent);
}
/* 命中关键词的高亮（原生摘要不标，这是本面板的补强之一）。 */
.dshm-mark {
  padding: 0 1px;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 22%, transparent);
  color: inherit;
}
.dshm-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.dshm-btn:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.dshm-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.dshm-btn--primary {
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.dshm-btn--danger {
  border-color: color-mix(in srgb, #ef4444 60%, transparent);
  color: #ef4444;
}
.dshm-btn--ghost {
  border: none;
  padding: 3px 6px;
  opacity: 0.75;
}
.dshm-btn--ghost:hover {
  opacity: 1;
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.dshm-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  user-select: none;
}
.dshm-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.dshm-table {
  width: 100%;
  border-collapse: collapse;
}
.dshm-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  font-weight: 600;
  padding: 6px 8px;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  white-space: nowrap;
}
.dshm-table td {
  padding: 5px 8px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent);
  vertical-align: middle;
}
.dshm-row {
  cursor: pointer;
}
.dshm-row:hover td {
  background: color-mix(in srgb, currentColor 4%, transparent);
}
.dshm-row--selected td {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.dshm-row--archived {
  opacity: 0.55;
}
.dshm-row--flash td {
  background: color-mix(in srgb, #3b82f6 18%, transparent);
}
.dshm-title {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshm-title--link:hover {
  text-decoration: underline;
}
.dshm-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.dshm-dot--running { background: #3b82f6; }
.dshm-dot--pending { background: #f59e0b; }
.dshm-dot--done { background: #22c55e; }
.dshm-dot--idle { background: color-mix(in srgb, currentColor 30%, transparent); }
.dshm-badge {
  display: inline-block;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 18px;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  color: color-mix(in srgb, currentColor 70%, transparent);
}
.dshm-badge--inline {
  margin-left: 6px;
  vertical-align: middle;
}
.dshm-actions {
  display: flex;
  gap: 2px;
  justify-content: flex-end;
  white-space: nowrap;
}
.dshm-actions--row .dshm-btn--ghost {
  opacity: 0;
}
.dshm-row:hover .dshm-actions--row .dshm-btn--ghost,
.dshm-row:focus-within .dshm-actions--row .dshm-btn--ghost {
  opacity: 0.85;
}
.dshm-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
}
.dshm-hint {
  font-size: 11px;
  line-height: 1.5;
  color: color-mix(in srgb, currentColor 60%, transparent);
}
.dshm-hint--inline {
  align-self: center;
}
/* 命中列表上方的提示行（说明"点结果跳不到原句"这件事与替代办法）。 */
.dshm-hint--pad {
  padding: 6px 12px;
}
.dshm-empty {
  padding: 32px 12px;
  text-align: center;
  color: color-mix(in srgb, currentColor 55%, transparent);
}
.dshm-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, currentColor 18%, transparent);
  z-index: 10;
}
.dshm-dialog {
  max-width: 360px;
  margin: 16px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
  border-radius: 8px;
  /* 需要实心背景（半透明会在内容上读不清），用系统色而非写死亮色：
     Canvas/CanvasText 由浏览器按当前主题解析，亮暗主题下都正确。 */
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}
.dshm-dialog__title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.dshm-dialog__body {
  margin: 0 0 12px;
}
.dshm-dialog__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.dshm-toast {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 6px;
  /* 反色提示条：同样用系统色，随主题自动反转。 */
  background: CanvasText;
  color: Canvas;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  z-index: 20;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
		let installed = false;
		/** 挂载样式标签（可重复调用；带标签去重）。 */
		function installStyles() {
			if (installed || typeof document === "undefined") return;
			if (document.querySelector(`style[data-plugin-css="dsh-conversation-manager/client.css"]`) !== null) {
				installed = true;
				return;
			}
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-conversation-manager";
			tag.dataset.pluginCss = STYLE_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			installed = true;
		}
		/** 卸载样式标签（插件卸载时由 ctx.effect 的处置器调用）。 */
		function removeStyles() {
			if (!installed || typeof document === "undefined") return;
			document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`)?.remove();
			installed = false;
		}
		//#endregion
		//#region src/client/manager.tsx
		/**
		* 对话管理器正文——右侧 Sidebar 页签 `conversation-manager` 的 body。
		*
		* 定位：只做**原生侧栏没有的事**——跨工作区总表、按时间批量、删除/恢复入口、回收站一览。
		* 搜索/筛选（除时间外）/排序/置顶/改名/分叉一律不做，原生侧栏已有。
		*
		* 两条能力边界（都是硬约束，不是偷懒）：
		*   1. 删除与恢复是**宿主的磁盘操作**，浏览器半没有文件访问权；面板只负责选择，
		*      然后复制一条**带确切 id 的指令**，由用户粘贴发送给宿主工具执行。
		*   2. 面板能读的只有**会话工作区内的文件**（`workspaceFiles` Remote）。所以回收站一览
		*      来自宿主写在工作区里的镜像 `.dsh-conversation-manager/trash.json`
		*      （见宿主半的 `lib/trash-mirror.js`；两半各自打包，路径在两处各写一份）。
		*/
		/** 回收站镜像在工作区里的相对路径。宿主半的 `lib/trash-mirror.js` 写它，两边必须一致。 */
		const TRASH_MIRROR_PATH = ".dsh-conversation-manager/trash.json";
		/**
		* 「显示已归档」开关的持久化键。
		*
		* 面板没有别的持久化通道（浏览器半没有文件权限），所以记住上一次的取舍只能靠
		* localStorage；它跨页签、跨重开都有效，取值就是 `'true'` / `'false'`。
		*/
		const SHOW_ARCHIVED_KEY = "dsh-conversation-manager/show-archived";
		/** 相对时间文案。用 any 收口，避免与实际 t 的泛型签名冲突。 */
		function relativeTime(ts, now, t) {
			if (!ts || ts <= 0) return "";
			const diff = Math.max(0, now - ts);
			const minutes = Math.floor(diff / 6e4);
			if (minutes < 1) return t("justNow");
			if (minutes < 60) return t("minutesAgo", { n: minutes });
			const hours = Math.floor(minutes / 60);
			if (hours < 24) return t("hoursAgo", { n: hours });
			const days = Math.floor(hours / 24);
			if (days < 7) return t("daysAgo", { n: days });
			return new Date(ts).toLocaleDateString();
		}
		/** 一行状态点：运行/等待交互/完成未读/空闲。label 传已翻译文案，供读屏与悬浮提示。 */
		function StatusDot({ status, label }) {
			let cls = "dshm-dot dshm-dot--idle";
			if (status?.pendingInteraction) cls = "dshm-dot dshm-dot--pending";
			else if (status?.running === true) cls = "dshm-dot dshm-dot--running";
			else if (status?.completionUnread) cls = "dshm-dot dshm-dot--done";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: cls,
				role: "img",
				"aria-label": label
			});
		}
		/**
		* 回收站镜像读取的"黑匣子"。
		*
		* 为什么需要：浏览器半跑在渲染进程里，宿主侧看不到它的状态，"标签卡在加载中"这类问题
		* 分不清是拿不到会话上下文、Remote 不可用、还是文件不存在。这里把每次读取的结果写进
		* localStorage（Electron 会落盘），离线也能读出来定位。只记诊断字段，不记任何会话内容。
		*/
		function probeTrash(entry) {
			try {
				const key = "dsh-conversation-manager/trash-probe";
				const raw = window.localStorage.getItem(key);
				const previous = raw === null ? [] : JSON.parse(raw);
				const log = (Array.isArray(previous) ? previous : []).slice(-4);
				log.push({
					...entry,
					at: (/* @__PURE__ */ new Date()).toISOString()
				});
				window.localStorage.setItem(key, JSON.stringify(log));
			} catch {}
		}
		/**
		* 复制文本到剪贴板。
		* 纯浏览器 API，不需要宿主能力——正是「面板负责选择、指令交给宿主」这条路的支点。
		* 先试异步剪贴板 API，失败再退回 execCommand（Electron 自定义协议下的兜底）。
		*/
		async function copyText(text) {
			try {
				if (typeof navigator !== "undefined" && navigator.clipboard !== void 0) {
					await navigator.clipboard.writeText(text);
					return true;
				}
			} catch {}
			try {
				const area = document.createElement("textarea");
				area.value = text;
				area.setAttribute("readonly", "");
				area.style.position = "fixed";
				area.style.left = "-9999px";
				document.body.appendChild(area);
				area.select();
				const ok = document.execCommand("copy");
				area.remove();
				return ok;
			} catch {
				return false;
			}
		}
		/**
		* 读「显示已归档」开关的上次取值。
		*
		* 缺省（没存过、存储被禁用、读取出错）一律返回 `true`——保持本插件一直以来的
		* 默认行为：已归档的对话照样列出来，只是带「已归档」徽标。
		*/
		function readShowArchived() {
			try {
				if (typeof window === "undefined") return true;
				return window.localStorage.getItem(SHOW_ARCHIVED_KEY) !== "false";
			} catch {
				return true;
			}
		}
		/**
		* 在摘要片段里标出关键词。
		*
		* 为什么要有它：原生侧栏的搜索结果只把 snippet 原样渲染（见 ui-workspace 的
		* `searchResultSnippet`），不标出命中位置；长摘要在 20 条列表里很难扫。
		* 大小写不敏感、不区分全半角（按码元直接匹配，与宿主"字面匹配"的语义一致）。
		*/
		function highlightSnippet(text, query) {
			if (query === "") return text;
			const haystack = text.toLowerCase();
			const needle = query.toLowerCase();
			const parts = [];
			let from = 0;
			let key = 0;
			for (;;) {
				const at = haystack.indexOf(needle, from);
				if (at < 0) break;
				if (at > from) parts.push(text.slice(from, at));
				parts.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("mark", {
					className: "dshm-mark",
					children: text.slice(at, at + needle.length)
				}, `hit-${key++}`));
				from = at + needle.length;
			}
			if (from < text.length) parts.push(text.slice(from));
			return parts;
		}
		function ManagerBody(props) {
			const { t, useSessions, useSessionStatus, useWorkspaces, useSession, openSession, setArchived, readTrashMirror, refreshSessions, searchContent } = props;
			const listState = useSessions((s) => s);
			const statusMap = useSessionStatus((s) => s);
			const workspaces = useWorkspaces((w) => w);
			/**
			* 本页签所属的会话 id——读工作区文件需要它当 scope。
			* `useSession` 是 session 作用域的标准 prop；用 typeof 兜一道，避免某个版本没提供时整块白屏
			* （prop 的存在性在组件生命周期内不变，因此这个条件调用不会改变 hook 顺序）。
			*/
			const sessionId = typeof useSession === "function" ? useSession((s) => s?.sessionId) : void 0;
			const archivedSet = (0, react.useMemo)(() => new Set(workspaces?.archivedSessionIds ?? []), [workspaces?.archivedSessionIds]);
			const workspaceOf = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				for (const ws of workspaces?.items ?? []) for (const sid of ws.sessionIds ?? []) if (!map.has(sid)) map.set(sid, ws);
				return map;
			}, [workspaces?.items]);
			const workspaceTitleOf = (id) => workspaceOf.get(id)?.title ?? t("ungrouped");
			const [selected, setSelected] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [stopConfirm, setStopConfirm] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			const [olderThan, setOlderThan] = (0, react.useState)(0);
			const [trash, setTrash] = (0, react.useState)(null);
			const [trashError, setTrashError] = (0, react.useState)(null);
			const [trashBusy, setTrashBusy] = (0, react.useState)(false);
			const [showArchived, setShowArchivedState] = (0, react.useState)(readShowArchived);
			const setShowArchived = (next) => {
				setShowArchivedState(next);
				try {
					window.localStorage.setItem(SHOW_ARCHIVED_KEY, String(next));
				} catch {}
			};
			const [query, setQuery] = (0, react.useState)("");
			const [searchBusy, setSearchBusy] = (0, react.useState)(false);
			const [hits, setHits] = (0, react.useState)([]);
			const [hitsHasMore, setHitsHasMore] = (0, react.useState)(false);
			const [searchError, setSearchError] = (0, react.useState)(null);
			const trimmedQuery = query.trim();
			(0, react.useEffect)(() => {
				const timer = setInterval(() => setNow(Date.now()), 3e4);
				return () => clearInterval(timer);
			}, []);
			(0, react.useEffect)(() => {
				if (notice === null) return;
				const timer = setTimeout(() => setNotice(null), 4200);
				return () => clearTimeout(timer);
			}, [notice]);
			const loadTrash = async () => {
				try {
					const candidates = [...sessionId === void 0 ? [] : [sessionId], ...listState?.ids ?? []];
					if (candidates.length === 0) {
						setTrash(null);
						setTrashBusy(false);
						setTrashError(t("trashNoSession"));
						probeTrash({
							phase: "no-candidates",
							hasSessionId: sessionId !== void 0
						});
						return;
					}
					setTrashBusy(true);
					setTrashError(null);
					const raced = await Promise.race([readTrashMirror(candidates), new Promise((resolve) => setTimeout(() => resolve({
						ok: false,
						message: "timed out after 6000ms"
					}), 6e3))]);
					setTrashBusy(false);
					probeTrash({
						phase: "read",
						hasSessionId: sessionId !== void 0,
						candidates: Math.min(candidates.length, 12),
						ok: raced.ok,
						tried: raced.tried,
						code: raced.code,
						message: raced.message,
						bytes: raced.text === void 0 ? 0 : raced.text.length
					});
					if (!raced.ok) {
						setTrash(null);
						setTrashError(raced.message ?? raced.code ?? "read failed");
						return;
					}
					try {
						setTrash(JSON.parse(raced.text ?? ""));
						setTrashError(null);
					} catch {
						setTrash(null);
						setTrashError("invalid mirror JSON");
					}
				} catch (error) {
					setTrash(null);
					setTrashBusy(false);
					const message = String(error?.message ?? error);
					setTrashError(message);
					probeTrash({
						phase: "threw",
						message
					});
				}
			};
			/**
			* 「刷新」= 重拉会话列表 + 重读回收站镜像。
			*
			* 前者是关键：删除是磁盘操作，宿主不推事件，客户端只在重连时重拉列表，
			* 所以删完后原生侧栏的行会一直留着；`sessions.refresh()` 让它立刻消失。
			*/
			const refreshAll = async () => {
				const list = await refreshSessions();
				await loadTrash();
				if (!list.ok) showNotice(t("actionFailedToast", { message: list.message ?? "" }));
				else showNotice(t("listRefreshed"));
			};
			(0, react.useEffect)(() => {
				if (sessionId === void 0 && (listState?.ids?.length ?? 0) === 0) return;
				loadTrash();
				refreshSessions();
			}, [sessionId, listState?.ids?.length]);
			(0, react.useEffect)(() => {
				if (trimmedQuery === "") {
					setHits([]);
					setHitsHasMore(false);
					setSearchError(null);
					setSearchBusy(false);
					return;
				}
				const controller = new AbortController();
				setSearchBusy(true);
				const timer = setTimeout(() => {
					(async () => {
						const outcome = await searchContent(trimmedQuery, controller.signal);
						if (controller.signal.aborted) return;
						setSearchBusy(false);
						if (!outcome.ok) {
							setHits([]);
							setHitsHasMore(false);
							setSearchError({
								code: outcome.code,
								message: outcome.message
							});
							return;
						}
						setSearchError(null);
						setHits(outcome.hits);
						setHitsHasMore(outcome.hasMore);
					})();
				}, 250);
				return () => {
					clearTimeout(timer);
					controller.abort();
				};
			}, [trimmedQuery]);
			/** 命中行：宿主只回 `{sessionId, snippet}`，其余用本地会话目录补齐。 */
			const hitRows = (0, react.useMemo)(() => hits.map((hit) => {
				const row = listState?.byId?.[hit.sessionId];
				return {
					id: hit.sessionId,
					title: row === void 0 ? hit.sessionId : row.displayTitle || row.id,
					workspace: workspaceTitleOf(hit.sessionId),
					archived: archivedSet.has(hit.sessionId),
					snippet: hit.snippet
				};
			}), [
				hits,
				listState,
				archivedSet,
				workspaceOf
			]);
			const copyHits = async () => {
				const lines = hitRows.map((row) => {
					const head = `- ${row.title}（${row.workspace}${row.archived ? " · 已归档" : ""}）`;
					return row.snippet === void 0 ? head : `${head}\n  ${row.snippet}`;
				});
				const ok = await copyText([`搜索「${trimmedQuery}」命中 ${hitRows.length} 个对话：`, ...lines].join("\n"));
				showNotice(ok ? t("copiedHitsHint", { count: hitRows.length }) : t("copyFailed"));
			};
			const rows = (0, react.useMemo)(() => {
				const byId = listState?.byId ?? {};
				const ids = listState?.ids ?? [];
				const out = [];
				const seen = /* @__PURE__ */ new Set();
				const add = (row) => {
					if (!row || seen.has(row.id)) return;
					seen.add(row.id);
					out.push(row);
				};
				for (const id of ids) add(byId[id]);
				for (const row of Object.values(byId)) add(row);
				const cutoff = olderThan === 0 ? 0 : now - olderThan * 864e5;
				return out.filter((row) => !row.blank && row.origin !== "subagent").filter((row) => showArchived || !archivedSet.has(row.id)).filter((row) => cutoff === 0 || (row.updatedAt ?? 0) < cutoff).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
			}, [
				listState,
				olderThan,
				now,
				showArchived,
				archivedSet
			]);
			(0, react.useEffect)(() => {
				const visible = new Set(rows.map((row) => row.id));
				setSelected((prev) => {
					let changed = false;
					const next = /* @__PURE__ */ new Set();
					for (const id of prev) if (visible.has(id)) next.add(id);
					else changed = true;
					return changed ? next : prev;
				});
			}, [rows]);
			const stats = (0, react.useMemo)(() => {
				const counted = Object.values(listState?.byId ?? {}).filter((row) => !row.blank && row.origin !== "subagent");
				return {
					total: counted.length,
					running: counted.filter((row) => statusMap.get(row.id)?.running === true).length,
					archived: counted.filter((row) => archivedSet.has(row.id)).length
				};
			}, [
				listState,
				statusMap,
				archivedSet
			]);
			const showNotice = (text) => setNotice(text);
			const toggleCheck = (id) => {
				setSelected((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			};
			const toggleAll = () => {
				setSelected((prev) => prev.size === rows.length ? /* @__PURE__ */ new Set() : new Set(rows.map((row) => row.id)));
			};
			const archiveMany = async (ids, archived, stopActivity = false) => {
				const active = [];
				const summaries = [];
				let failed = 0;
				for (const id of ids) {
					const res = await setArchived(id, archived, stopActivity);
					if (res.ok) continue;
					if (!stopActivity && res.code === "workspace/session-active") {
						active.push(id);
						if (res.activity !== void 0) summaries.push(res.activity);
					} else failed += 1;
				}
				if (active.length > 0) {
					const activity = [...new Set(summaries)].join(" · ");
					setStopConfirm(activity === "" ? { ids: active } : {
						ids: active,
						activity
					});
					return;
				}
				if (failed > 0) {
					showNotice(t("batchFailedToast", { count: failed }));
					return;
				}
				showNotice(archived ? t("archivedToast") : t("unarchivedToast"));
				setSelected(/* @__PURE__ */ new Set());
			};
			const copyDeleteInstruction = async () => {
				const picked = rows.filter((row) => selected.has(row.id));
				if (picked.length === 0) return;
				const ok = await copyText([
					"请用 conversation_delete 删除下面这些对话（confirm: true，默认进回收站）：",
					...picked.map((row) => `- ${row.id}  （${row.displayTitle}）`),
					"如果有正在运行的，跳过并告诉我。"
				].join("\n"));
				showNotice(ok ? t("copiedDeleteHint", { count: picked.length }) : t("copyFailed"));
			};
			const copyRestoreInstruction = async () => {
				const ok = await copyText("请用 conversation_restore 恢复最近删掉的那一批对话。");
				showNotice(ok ? t("copiedRestoreHint") : t("copyFailed"));
			};
			/** 清空回收站：不可恢复，所以指令里写明这一点，并带上当前批次数便于核对。 */
			const copyPurgeInstruction = async () => {
				const batches = trash?.count ?? 0;
				const ok = await copyText([`请用 conversation_purge 清空回收站（all: true, confirm: true），当前 ${batches} 批。`, "这会永久删除，无法恢复。"].join("\n"));
				showNotice(ok ? t("copiedPurgeHint", { count: batches }) : t("copyFailed"));
			};
			const selectedCount = selected.size;
			const allChecked = rows.length > 0 && selectedCount === rows.length;
			const batchLines = (trash?.batches ?? []).slice(0, 3);
			const trashLabel = trashError !== null ? t("trashUnavailable", { message: trashError }) : trash === null ? t("loading") : (trash.count ?? 0) === 0 ? t("trashEmpty") : t("trashTitle", { count: trash.count ?? 0 });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshm-root",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshm-toolbar",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshm-toolbar__row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dshm-search",
									type: "search",
									value: query,
									placeholder: t("searchPlaceholder"),
									title: t("searchHint"),
									onChange: (event) => setQuery(event.target.value)
								}), trimmedQuery !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dshm-btn dshm-btn--ghost",
									onClick: () => setQuery(""),
									children: t("searchClear")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshm-toolbar__row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshm-badge",
										children: t("statsLine", {
											count: stats.total,
											running: stats.running,
											archived: stats.archived
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: "dshm-select",
										value: String(olderThan),
										onChange: (event) => setOlderThan(Number(event.target.value)),
										title: t("timeFilterHint"),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "0",
												children: t("filterAll")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "7",
												children: t("filterOlder7")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "30",
												children: t("filterOlder30")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "90",
												children: t("filterOlder90")
											})
										]
									}),
									(olderThan !== 0 || !showArchived) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshm-badge",
										children: t("filteredCount", { count: rows.length })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "dshm-toggle",
										title: t("showArchivedHint"),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: showArchived,
											onChange: (event) => setShowArchived(event.target.checked)
										}), t("showArchived")]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "dshm-toggle",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: allChecked,
											onChange: toggleAll
										}), t("selectAll")]
									})
								]
							}),
							selectedCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshm-toolbar__row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshm-badge",
										children: t("selectedCount", { count: selectedCount })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn",
										onClick: () => {
											archiveMany([...selected], true);
										},
										children: t("archive")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn",
										onClick: () => {
											archiveMany([...selected], false);
										},
										children: t("unarchive")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn dshm-btn--danger",
										onClick: () => {
											copyDeleteInstruction();
										},
										children: t("deleteSelected")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn dshm-btn--ghost",
										onClick: () => setSelected(/* @__PURE__ */ new Set()),
										children: t("clearSelection")
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshm-list",
						children: trimmedQuery !== "" ? searchBusy && hits.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshm-empty",
							children: t("loading")
						}) : searchError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshm-empty",
							children: [t("searchFailed", { message: searchError.message ?? searchError.code ?? "" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshm-hint",
								children: t("searchDisabledHint")
							})]
						}) : hitRows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshm-empty",
							children: t("searchNoHits")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshm-toolbar__row dshm-toolbar__row--pad",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshm-badge",
										children: t("searchHits", { count: hitRows.length })
									}),
									hitsHasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshm-hint dshm-hint--inline",
										children: t("searchMore")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn dshm-btn--ghost",
										onClick: () => {
											copyHits();
										},
										children: t("searchCopy")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshm-hint dshm-hint--pad",
								children: t("searchJumpHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dshm-hits",
								children: hitRows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dshm-hit",
									onClick: () => {
										const res = openSession(row.id);
										if (!res.ok) showNotice(t("actionFailedToast", { message: res.message ?? "" }));
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dshm-hit__head",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusDot, {
												status: statusMap.get(row.id),
												label: t("statusIdle")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dshm-hit__title",
												children: row.title
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dshm-hit__meta",
												children: row.workspace
											}),
											row.archived && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dshm-badge dshm-badge--inline",
												children: t("archivedBadge")
											})
										]
									}), row.snippet !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshm-hit__snippet",
										children: highlightSnippet(row.snippet, trimmedQuery)
									})]
								}) }, row.id))
							})
						] }) : rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshm-empty",
							children: listState?.phase !== "ready" ? t("loading") : t("empty")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
							className: "dshm-table",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("colTitle") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("colWorkspace") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("colUpdated") })
							] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((row) => {
								const status = statusMap.get(row.id);
								const archived = archivedSet.has(row.id);
								const statusLabel = t(status?.pendingInteraction ? "statusPending" : status?.running === true ? "statusRunning" : status?.completionUnread ? "statusDone" : "statusIdle");
								const rowCls = [
									"dshm-row",
									selected.has(row.id) ? "dshm-row--selected" : "",
									archived ? "dshm-row--archived" : ""
								].filter(Boolean).join(" ");
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
									className: rowCls,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											onClick: () => toggleCheck(row.id),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: selected.has(row.id),
												onChange: () => toggleCheck(row.id),
												onClick: (event) => event.stopPropagation()
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											title: statusLabel,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusDot, {
												status,
												label: statusLabel
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dshm-title dshm-title--link",
											title: `${row.displayTitle}\n${row.id}`,
											onClick: () => {
												const res = openSession(row.id);
												if (!res.ok) showNotice(t("actionFailedToast", { message: res.message ?? "" }));
											},
											children: row.displayTitle
										}), archived ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dshm-badge dshm-badge--inline",
											children: t("archivedBadge")
										}) : null] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dshm-title",
											title: workspaceTitleOf(row.id),
											children: workspaceTitleOf(row.id)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: relativeTime(row.updatedAt, now, t) })
									]
								}, row.id);
							}) })]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshm-footer",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshm-hint",
								children: t("hostOnlyHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshm-toolbar__row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshm-badge",
										title: trash?.trashRoot ?? "",
										children: trashLabel
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn dshm-btn--ghost",
										disabled: trashBusy,
										onClick: () => {
											refreshAll();
										},
										children: t("refresh")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn",
										onClick: () => {
											copyRestoreInstruction();
										},
										children: t("restore")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn dshm-btn--danger",
										title: t("purgeHint"),
										onClick: () => {
											copyPurgeInstruction();
										},
										children: t("purgeBin")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshm-hint dshm-hint--inline",
										children: t("pasteHint")
									})
								]
							}),
							batchLines.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshm-hint",
								children: t("batchLine", {
									batch: entry.batch,
									count: entry.entries ?? 0,
									size: entry.sizeKB ?? 0
								})
							}, entry.batch))
						]
					}),
					stopConfirm && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshm-overlay",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshm-dialog",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshm-dialog__title",
									children: t("stopArchiveTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshm-dialog__body",
									children: t("stopArchiveBody", { count: stopConfirm.ids.length })
								}),
								stopConfirm.activity !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshm-dialog__body",
									children: t("runningWork", { activity: stopConfirm.activity })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshm-dialog__footer",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn",
										onClick: () => setStopConfirm(null),
										children: t("cancel")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dshm-btn dshm-btn--danger",
										onClick: () => {
											const ids = stopConfirm.ids;
											setStopConfirm(null);
											archiveMany(ids, true, true);
										},
										children: t("stopAndArchive")
									})]
								})
							]
						})
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshm-toast",
						children: notice
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-conversation-manager";
		/**
		* 依赖的浏览器服务。
		*
		* - `sessions`：面板的「刷新」调用 `sessions.refresh()`（重新拉取列表基线，让已从磁盘
		*   删除的行立刻从原生列表消失）。列表与状态本身走标准 props。
		* - `remote` + **`remote.workspaceFiles`**：读会话工作区里的回收站镜像。
		*   命名空间必须单独声明——只写 `remote` 不够，访问 `ctx.remote.workspaceFiles` 会被
		*   Cordis 以 "cannot get property without inject" 拒绝（实测踩过这个坑）。
		*   ui-workspace 的 `'remote.directoryPicker'` 是同一写法。
		* - `uiWorkspace` 故意不在此列：它在 apply 阶段不一定已注册，而调用只发生在用户交互时，
		*   所以那条路径用惰性 `ctx.get` 解析。
		*/
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.workspaceFiles",
			"sessions",
			"workspaces",
			"sidebarRightTabs",
			"sidebarRight"
		];
		/** 页签类型的实现身份，同时是正文/标题 keyed slot 的 key。 */
		const MANAGER_ID = "dsh-conversation-manager";
		/** 页签类型判别式：`openTab('conversation-manager')` 用它点名。 */
		const MANAGER_KIND = "conversation-manager";
		function ManagerTitle({ t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: t("title") });
		}
		function LocateRow({ sessionId, useMenuOpenState, locateInManager, t }) {
			const [, setMenuOpen] = useMenuOpenState();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
				separatorBefore: true,
				onSelect: () => {
					setMenuOpen(false);
					locateInManager(sessionId);
				},
				children: t("locateInManager")
			});
		}
		/**
		* 打开（或聚焦）对话管理器页签。
		*
		* `params` 是 JSON 形状的同进程数据，由页面类型自己消费；这里用一个窄适配类型，
		* 不依赖 DSH 各版本的参数声明合并是否覆盖到本类型。
		*/
		function openManagerTab(ctx, params) {
			ctx.sidebarRight.openTab(MANAGER_KIND, params === void 0 ? {} : { params });
		}
		function ManagerHeaderButton({ openManager, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "md",
				onClick: () => openManager(),
				children: t("title")
			});
		}
		/**
		* 激活探针：把「浏览器半激活结果」记一行到 localStorage。
		*
		* 为什么需要它：浏览器半运行在渲染进程里，宿主半（包括 conversation_selftest）看不到它，
		* 「页签没出现」就分不清是**注册失败**、**apply 中途抛错**，还是**用户没找到入口**。
		* localStorage 落在磁盘上（Electron 的 userData/Local Storage），可以离线读出来。
		* 只写一个键、只存结果与错误信息，不存任何对话内容。
		*/
		function recordActivation(entry) {
			try {
				const key = "dsh-conversation-manager/activation";
				const raw = window.localStorage.getItem(key);
				const previous = raw === null ? [] : JSON.parse(raw);
				const log = (Array.isArray(previous) ? previous : []).slice(-4);
				log.push({
					...entry,
					at: (/* @__PURE__ */ new Date()).toISOString()
				});
				window.localStorage.setItem(key, JSON.stringify(log));
			} catch {}
		}
		/** 把任意错误折叠成 JSON 结果（客户端不共享错误类身份，只认名字与 rpcError.code）。 */
		function fail(error) {
			const failure = error;
			const code = failure?.rpcError?.code ?? failure?.code;
			const message = failure?.rpcError?.message ?? failure?.message ?? String(error);
			return {
				ok: false,
				...code === void 0 ? {} : { code },
				message
			};
		}
		/**
		* 真正干活的 apply 体。外层 `apply` 只负责包一层探针：
		* 浏览器半跑在渲染进程里，宿主侧看不到它的状态，出错时也没有日志可读，
		* 所以「注册了什么 / 在哪一步炸了」必须由它自己写进 localStorage。
		*/
		function applyInner(ctx) {
			const t = ctx.locale.bind(NS);
			const sessions = ctx.get("sessions");
			const workspaces = ctx.get("workspaces");
			/** 惰性解析：交互发生时该服务必已就绪。 */
			const uiWorkspace = () => ctx.get("uiWorkspace");
			ctx.effect(() => {
				installStyles();
				return () => removeStyles();
			}, "dsh-conversation-manager: styles");
			ctx.effect(() => ctx.locale.register(NS, {
				en,
				zh
			}), "dsh-conversation-manager: dictionaries");
			const disposeTabType = ctx.sidebarRightTabs.register({
				id: MANAGER_ID,
				kind: MANAGER_KIND,
				priority: "extension",
				title: () => t("title"),
				guide: [{
					id: "conversation-manager",
					order: 60,
					title: () => t("guideTitle"),
					description: () => t("guideDescription")
				}]
			});
			ctx.effect(() => () => {
				disposeTabType();
			}, "dsh-conversation-manager: tab type");
			const face = {
				openSession(id) {
					const service = uiWorkspace();
					if (service === void 0) return {
						ok: false,
						message: "uiWorkspace service is unavailable"
					};
					try {
						service.openSession(id);
						return { ok: true };
					} catch (error) {
						return fail(error);
					}
				},
				async setArchived(id, archived, stopActivity = false) {
					try {
						if (archived) await workspaces.archiveSession(id, stopActivity ? { stopActivity: true } : {});
						else await workspaces.unarchiveSession(id);
						return { ok: true };
					} catch (error) {
						return fail(error);
					}
				},
				/**
				* 读会话工作区里的回收站镜像（宿主写的批次概览）。
				*
				* 走 `workspaceFiles` Remote：它的 scope 就是 sessionId（branded string），
				* 路径相对会话工作区根。这里用窄适配类型，避免把内部 Remote 类型引进来。
				*/
				/**
				* 重新拉取会话列表基线（`sessions.refresh()`）。
				*
				* 为什么面板需要它：删除是宿主的磁盘操作，宿主不会为此推事件；客户端只在
				* **重连**时重拉列表。所以删完之后原生侧栏里的行仍然在，直到重连或重启。
				* 这一键刷新让"碍眼的那行立刻消失"不必重连。
				*/
				async refreshSessions() {
					try {
						await sessions.refresh();
						return { ok: true };
					} catch (error) {
						return fail(error);
					}
				},
				/**
				* 搜索对话正文（宿主的内容索引）。
				*
				* 只走同一个 Remote：`sessions.search(query, signal)` → `remote.session.search({ query }, signal)`。
				* 宿主每条只回 `{ sessionId, snippet }`（snippet 截到 240 码点），并且**服务端就截到 20 个会话**
				* ——`hasMore` 表示"还有更多会话匹配"，不是分页游标。这些是从宿主实现里读出来的，所以面板
				* 不去承诺"显示超过 20 条"。
				*
				* 索引没打开时宿主会抛错（`SESSION_QUERY_SEARCH_DISABLED` 之类），面板原样显示——
				* 那种情况下"没有结果"是假象，必须让用户看到真实原因。
				*/
				async searchContent(query, signal) {
					const clean = query.trim();
					if (clean === "") return {
						ok: true,
						hits: [],
						hasMore: false
					};
					try {
						const result = await sessions.search(clean, signal);
						if (!result?.ok) return {
							ok: false,
							hits: [],
							hasMore: false,
							code: result?.error?.code,
							message: result?.error?.message ?? "search failed"
						};
						return {
							ok: true,
							hits: (result.value?.items ?? []).map((item) => ({
								sessionId: String(item?.sessionId ?? ""),
								snippet: typeof item?.snippet === "string" ? String(item.snippet) : void 0
							})).filter((hit) => hit.sessionId !== ""),
							hasMore: result.value?.hasMore === true
						};
					} catch (error) {
						const failure = fail(error);
						return {
							ok: false,
							hits: [],
							hasMore: false,
							code: failure.code,
							message: failure.message
						};
					}
				},
				/**
				* 读会话工作区里的回收站镜像（宿主写的批次概览）。
				*
				* `workspaceFiles` 的 scope 必须是会话 id。面板能从标准 prop `useSession` 拿到本次
				* 页签所属会话的 id（实测可用：探针记录 hasSessionId: true），传一串候选只是稳健性兜底
				* ——镜像是全局同一份、宿主又把它写进了每个存活会话的工作区，所以任意一个能读通的会话
				* 都给出同样的内容，也不会因为某个会话没有镜像而整体失败。
				*
				* 每次调用都带上 AbortSignal：Remote 签名要求它，缺省有可能让请求悬着不返回。
				*
				* 注意：`ctx.remote.workspaceFiles` 的访问必须在 try 内——只声明 `'remote'` 而未声明
				* `'remote.workspaceFiles'` 时，Cordis 会在这里抛错；一旦抛在 try 外，异常会变成未处理的
				* Promise 拒绝，界面表现为"永远加载中"（踩过这个坑，见 README）。
				*/
				async readTrashMirror(ids) {
					const read = ctx.remote?.workspaceFiles?.read;
					if (typeof read !== "function") return {
						ok: false,
						message: "workspaceFiles remote is unavailable",
						tried: 0
					};
					const candidates = [...new Set(ids)].slice(0, 12);
					let last = {
						ok: false,
						message: "no candidate session id",
						tried: 0
					};
					let tried = 0;
					for (const id of candidates) {
						tried += 1;
						try {
							const result = await read(id, TRASH_MIRROR_PATH, {}, new AbortController().signal);
							if (result?.ok === true) return {
								ok: true,
								text: String(result.value?.text ?? ""),
								tried
							};
							last = {
								ok: false,
								code: result?.error?.code,
								message: result?.error?.message ?? "read failed",
								tried
							};
						} catch (error) {
							last = {
								...fail(error),
								tried
							};
						}
					}
					return {
						...last,
						tried
					};
				}
			};
			ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: MANAGER_ID,
				locale: NS,
				inject: () => face
			}, ManagerBody));
			ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: MANAGER_ID,
				locale: NS
			}, ManagerTitle));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "dsh-conversation-manager.open",
				order: 50,
				locale: NS,
				inject: () => ({ openManager: () => openManagerTab(ctx) })
			}, ManagerHeaderButton));
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: "dsh-conversation-manager.locate",
				order: 500,
				locale: NS,
				inject: () => ({ locateInManager: (sessionId) => {
					openManagerTab(ctx, { focusSessionId: sessionId });
				} })
			}, LocateRow));
		}
		/**
		* 插件入口：包一层激活探针。失败时先记录再原样抛出，不吞掉框架的报错。
		*/
		function apply(ctx) {
			recordActivation({ phase: "enter" });
			try {
				applyInner(ctx);
				recordActivation({
					phase: "done",
					ok: true,
					kind: MANAGER_KIND,
					id: MANAGER_ID,
					slots: [
						"conversation.session.header.actions",
						"sidebar.right.pane.tab",
						"sidebar.right.pane.tab.title",
						"sidebar.workspaces.session.menu.item"
					],
					locale: NS
				});
			} catch (error) {
				const info = error;
				recordActivation({
					phase: "error",
					ok: false,
					message: info?.message ?? String(error),
					stack: typeof info?.stack === "string" ? info.stack.slice(0, 2e3) : void 0,
					locale: NS
				});
				throw error;
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map