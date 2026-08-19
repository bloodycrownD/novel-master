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
import { isVfsError } from "@novel-master/core/vfs";

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

/** 物理根下的顶层挂载点：根请求按此拆分逐 scope 拉取（见 handlePhysicalList）。 */
const ROOT_SCOPE_DIRS = ["/meta", "/template", "/projects"];

/**
 * 列物理子树全部行（单次批量拉取）：根行自身不出现在结果里，
 * 虚拟目录（/projects、/projects/{pid}/sessions 等）同样合成目录行。
 *
 * 根请求按顶层挂载点拆成多次 listTree（core 单次调用内部同为逐 scope
 * 查询，查询量等价），由此获得 per-scope 错误隔离：某子树拉取抛
 * NOT_FOUND（如项目/会话被并发删除）或其他异常时跳过该子树，
 * 其余域行照常返回，不再一个子树失败拖垮整树（ok:false 整树空白）。
 */
export async function handlePhysicalList(
  req: PhysicalListRequest,
): Promise<IpcResult<WorkplaceListRowDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const vfs = getPhysicalVfs(rt);
    const isRoot = req.path === "/";
    const scopeDirs = isRoot ? ROOT_SCOPE_DIRS : [req.path];
    const rows: WorkplaceListRowDto[] = [];
    if (isRoot) {
      // 三个挂载点根目录行自身（listTree 不含查询根行，补齐供面板顶层展示）
      for (const dir of ROOT_SCOPE_DIRS) {
        rows.push(toPhysicalRow({ path: dir, kind: "directory" }));
      }
    }
    for (const scopeDir of scopeDirs) {
      try {
        rows.push(
          ...(await vfs.listTree(scopeDir)).map((entry) =>
            toPhysicalRow(entry),
          ),
        );
      } catch (err) {
        // vfsNotFound：子树已不存在（如项目被并发删除）→ 跳过该子树；
        // 其他异常同样降级跳过（不中断整树），留 warn 便于排查
        if (!isVfsError(err, "NOT_FOUND")) {
          console.warn("[physical-list] 子树拉取失败，已跳过:", scopeDir, err);
        }
        continue;
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
