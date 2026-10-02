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

export const STYLE_TAG_ID = 'dsh-conversation-manager/client.css'

export const CSS = `
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
`

let installed = false

/** 挂载样式标签（可重复调用；带标签去重）。 */
export function installStyles(): void {
  if (installed || typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) {
    installed = true
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-conversation-manager'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  installed = true
}

/** 卸载样式标签（插件卸载时由 ctx.effect 的处置器调用）。 */
export function removeStyles(): void {
  if (!installed || typeof document === 'undefined') return
  const tag = document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
  tag?.remove()
  installed = false
}