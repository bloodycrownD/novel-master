import type { WorktreeListRowDto, WorkspacePanelScope } from "@shared/ipc-types";

export type WorkspaceContextTarget =
  | {
      readonly kind: "blank";
      readonly panelScope: WorkspacePanelScope;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "row";
      readonly panelScope: WorkspacePanelScope;
      readonly row: WorktreeListRowDto;
      readonly x: number;
      readonly y: number;
    };

export function parentPathForTarget(target: WorkspaceContextTarget): string {
  if (target.kind === "blank") {
    return "/";
  }
  return target.row.kind === "dir" ? target.row.path : "/";
}

export function workspaceMenuItems(target: WorkspaceContextTarget): Array<{
  action: string;
  label: string;
  danger?: boolean;
}> {
  if (target.kind === "blank") {
    return [
      { action: "create-file", label: "新建文件" },
      { action: "create-folder", label: "新建文件夹" },
    ];
  }

  const isDir = target.row.kind === "dir";
  if (isDir) {
    return [
      { action: "create-file", label: "新建文件" },
      { action: "create-folder", label: "新建文件夹" },
      { action: "rule-config", label: "规则配置" },
      { action: "rename", label: "重命名" },
      { action: "delete", label: "删除", danger: true },
    ];
  }

  return [
    { action: "file-inclusion", label: "状态设置" },
    { action: "rename", label: "重命名" },
    { action: "delete", label: "删除文件", danger: true },
  ];
}
