/**
 * 用户 VFS 操作预览正文（presentation）。
 *
 * @module presentation/chat/user-vfs-turn-preview
 */

import type {UserVfsTurnView} from "@/domain/chat/logic/vfs-turn/user-vfs-turn-view.js";

/** Real prompt / CLI 预览：单卡片正文。 */
/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export function formatUserVfsTurnPreviewBody(view: UserVfsTurnView): string {
  const lines: string[] = ["【用户 VFS 操作】"];
  if (view.actions.length > 0) {
    lines.push("", "操作：");
    for (const action of view.actions) {
      const label = action.name || action.kind;
      const base = `${label} · ${action.path}`;
      lines.push(`- ${action.method && action.method !== label ? `${base} (${action.method})` : base}`);
      for (const hunk of action.hunks) {
        lines.push(`  edit-hunk #${hunk.index}`);
        lines.push(`  old: ${hunk.old}`);
        lines.push(`  new: ${hunk.new}`);
      }
    }
  }
  if (view.toolUses.length > 0) {
    lines.push("", "工具：");
    for (let i = 0; i < view.toolUses.length; i++) {
      const tu = view.toolUses[i]!;
      const tr = view.toolResults[i];
      const status = tr?.ok === false ? "失败" : tr != null ? "成功" : "—";
      lines.push(`- ${tu.name} (${tu.id}) · ${status}`);
    }
  }
  if (view.bridgeText.trim() !== "") {
    lines.push("", view.bridgeText.trim());
  }
  return lines.join("\n");
}
