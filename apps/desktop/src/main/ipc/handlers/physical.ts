/**
 * 只读物理树浏览 IPC handlers — list/read（跨域拼接视图，无任何写通道）。
 *
 * @module ipc/handlers/physical
 */
import type {
  IpcResult,
  PhysicalListRequest,
  PhysicalReadRequest,
  VfsReadResultDto,
  WorkplaceListRowDto,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { getPhysicalVfs } from "../resolve-vfs-scope.js";
import { formatIpcError } from "../format-ipc-error.js";

/** VfsListEntry.kind → WorkplaceListRowDto.kind */
function toRowKind(kind: string): "dir" | "file" {
  return kind === "directory" ? "dir" : "file";
}

/** 物理树行 DTO：规则类字段对物理树无意义，恒为缺省值。 */
function toPhysicalRow(entry: {
  path: string;
  kind: string;
  label?: string;
}): WorkplaceListRowDto {
  if (toRowKind(entry.kind) === "dir") {
    return entry.label == null
      ? { kind: "dir", path: entry.path, ruleState: "rule_off" }
      : {
          kind: "dir",
          path: entry.path,
          ruleState: "rule_off",
          label: entry.label,
        };
  }
  return {
    kind: "file",
    path: entry.path,
    inclusionMode: "auto",
    displayState: "full",
  };
}

/**
 * 列物理子树全部行（BFS 收敛）：根行自身不出现在结果里，
 * 虚拟目录（/projects、/projects/{pid}/sessions 等）同样合成目录行。
 */
export async function handlePhysicalList(
  req: PhysicalListRequest,
): Promise<IpcResult<WorkplaceListRowDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const vfs = getPhysicalVfs(rt);
    const rows: WorkplaceListRowDto[] = [];
    const queue: string[] = [req.path];
    while (queue.length > 0) {
      const dir = queue.shift()!;
      const entries = await vfs.list(dir);
      for (const entry of entries) {
        rows.push(toPhysicalRow(entry));
        if (entry.kind === "directory") {
          queue.push(entry.path);
        }
      }
    }
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/** 读物理路径文件内容：前缀解析后走对应域单 scope read（只读，无保存通道）。 */
export async function handlePhysicalRead(
  req: PhysicalReadRequest,
): Promise<IpcResult<VfsReadResultDto>> {
  try {
    const rt = await getDesktopRuntime();
    const result = await getPhysicalVfs(rt).read(req.path);
    return {
      ok: true,
      data: {
        content: result.content,
        version: result.version,
        mtimeMs: result.mtimeMs,
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
