/**
 * Desktop renderer 对 `@novel-master/core/vfs` 的具名薄再导出。
 * 禁止 `export *`；禁止 createVfsService 等工厂。
 *
 * 工作区面板作用域优先用 `@shared/ipc-types` 的 `WorkspacePanelScope` /
 * `VfsScopeRequest`；下列 `VfsScope` 供预览等过渡路径。
 *
 * core 侧 `vfsUserMessage` 返回 descriptor、`validateVfsEntryName` 的 reason 为
 * descriptor（G1.5/G1.6）：本层经 `coreT` 翻译成 string 再导出，renderer
 * 消费点零改动。
 */

import { validateVfsEntryName as coreValidateVfsEntryName, vfsUserMessage } from "@novel-master/core/vfs";
import type { VfsScope } from "@novel-master/core/vfs";
import { coreT } from "./core-i18n.js";

export type { VfsScope } from "@novel-master/core/vfs";
export type { VfsEntryNameValidation } from "@novel-master/core/vfs";

export function formatVfsErrorForUser(error: unknown, scope?: VfsScope): string {
  return coreT(vfsUserMessage(error, scope));
}

export function validateVfsEntryName(name: string): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const result = coreValidateVfsEntryName(name);
  return result.ok ? result : { ok: false, reason: coreT(result.reason) };
}
