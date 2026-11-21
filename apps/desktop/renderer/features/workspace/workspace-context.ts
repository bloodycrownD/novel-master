import type { WorkplaceListRowDto, WorkspacePanelScope } from "@shared/ipc-types";
import { coreT } from "@shared/logic/core-i18n";

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
      readonly row: WorkplaceListRowDto;
      readonly x: number;
      readonly y: number;
    };

export function parentPathForTarget(target: WorkspaceContextTarget): string {
  if (target.kind === "blank") {
    return "/";
  }
  return target.row.kind === "dir" ? target.row.path : "/";
}

/**
 * ZIP 子树目标：blank ≡ `/`；目录行（含域根 `/`）为其 path；文件行无 ZIP。
 */
export function zipDirectoryPathForTarget( target: WorkspaceContextTarget ): string | null {
  if (target.kind === "blank") {
    return "/";
  }
  if (target.row.kind === "dir") {
    return target.row.path;
  }
  return null;
}

/**
 * 单文件导出的逻辑路径：仅文件行有（=row.path），空白处与目录行无单文件导出。
 *
 * 与 `zipDirectoryPathForTarget` 互为镜像：目录目标走 ZIP 子树导出、文件目标走
 * 单文件另存，两者各管一半，测试对称断言。
 */
export function exportFilePathForTarget( target: WorkspaceContextTarget ): string | null {
  if (target.kind === "row" && target.row.kind === "file") {
    return target.row.path;
  }
  return null;
}

/**
 * 工作区右键菜单。导入/导出已收敛为两项（空白处与目录行），形式（ZIP/角色卡/单文件）
 * 由「导入」弹窗二次选择；文件行没有「导入」（它自己就是被导入/导出的对象），
 * 导出类型直达——文件导单文件、目录导 ZIP 子树，无需确认。
 */
export function workspaceMenuItems(target: WorkspaceContextTarget): Array<{
  action: string;
  label: string;
  danger?: boolean;
}> {
  if (target.kind === "blank") {
    return [
      { action: "create-file", label: coreT({key: "ui.vfs.create_file"}) },
      { action: "create-folder", label: coreT({key: "ui.vfs.menu_create_folder"}) },
      { action: "import", label: coreT({key: "ui.common.import"}) },
      { action: "export", label: coreT({key: "ui.common.export"}) },
    ];
  }

  const isDir = target.row.kind === "dir";
  if (isDir) {
    return [
      { action: "create-file", label: coreT({key: "ui.vfs.create_file"}) },
      { action: "create-folder", label: coreT({key: "ui.vfs.menu_create_folder"}) },
      { action: "import", label: coreT({key: "ui.common.import"}) },
      { action: "export", label: coreT({key: "ui.common.export"}) },
      { action: "rule-config", label: coreT({key: "ui.vfs.menu_rules_config"}) },
      { action: "rename", label: coreT({key: "ui.common.rename"}) },
      { action: "delete", label: coreT({key: "ui.vfs.menu_delete_folder"}), danger: true },
    ];
  }

  return [
    { action: "file-inclusion", label: coreT({key: "ui.vfs.menu_status_settings"}) },
    { action: "export", label: coreT({key: "ui.common.export"}) },
    { action: "rename", label: coreT({key: "ui.common.rename"}) },
    { action: "delete", label: coreT({key: "ui.vfs.menu_delete_file"}), danger: true },
  ];
}

/** 导入 ZIP 确认文案（子树覆盖语义：目标目录下全部内容）。 */
export function zipImportConfirmMessage(directoryPath: string): string {
  return coreT({key: "ui.vfs.import_overwrite_confirm_desktop", params: {path: directoryPath === "/" ? coreT({key: "ui.vfs.target_root"}) : directoryPath}});
}

/**
 * 导入角色卡确认文案（目标目录覆盖语义）。
 *
 * D9 要求角色卡与 ZIP 各有一条独立文案：ZIP 是「解压整棵树、覆盖目录全部内容」，
 * 角色卡是「解析角色卡并写入目标目录」，两者对工作区的影响面不同，合并文案会让用户
 * 按错误的预期点确认。
 */
export function characterCardImportConfirmMessage( directoryPath: string ): string {
  return coreT({key: "ui.vfs.import_card_confirm_desktop", params: {path: directoryPath === "/" ? coreT({key: "ui.vfs.target_root"}) : directoryPath}});
}

/**
 * 批量导入的覆盖确认文案（拖入两条链路 + 菜单单文件链路三处共享）。
 *
 * 三条链路的冲突语义完全一致（同名文件/目录将被覆盖且不可撤销），文案只留一份，
 * 免得第四处消费点出现时又抄出第二句措辞。
 */
export function batchIngestOverwriteMessage(conflictCount: number): string {
  return coreT({key: "ui.vfs.conflict_confirm_desktop", params: {count: conflictCount}});
}
