import type { PreviewFileSelection } from "@shared/ipc-types";

/** 预览标签唯一键：scope + 路径 */
export function previewTabKey(
  workspaceScope: PreviewFileSelection["workspaceScope"],
  path: string,
): string {
  return `${workspaceScope}:${path}`;
}
