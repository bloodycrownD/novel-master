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
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { ResolveVfsScope } from "../resolve-vfs-scope.js";
import { FormatIpcError } from "../format-ipc-error.js";
import { IpcResults } from "../ipc-result.js";
import { AppErrorOps } from "@novel-master/core/errors";
import { LogFactory } from "@novel-master/core/log";

const log = LogFactory.create("desktop.ipc.physical");

/** 物理根下的顶层挂载点：根请求按此拆分逐 scope 拉取（见 Physical.list）。 */
const ROOT_SCOPE_DIRS = ["/meta", "/template", "/projects"];

export const Physical = {
    /** 物理树行 DTO：规则类字段对物理树无意义，恒为缺省值。 */
    toPhysicalRow(entry: {
        path: string;
        kind: string;
        label?: string;
    }): WorkplaceListRowDto {
        if (entry.kind === "directory") {
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
    },

    /**
   * 列物理子树全部行（单次批量拉取）：根行自身不出现在结果里，
   * 虚拟目录（/projects、/projects/{pid}/sessions 等）同样合成目录行。
   *
   * 根请求按顶层挂载点拆成多次 listTree（core 单次调用内部同为逐 scope
   * 查询，查询量等价），由此获得 per-scope 错误隔离：某子树拉取抛
   * NOT_FOUND（如项目/会话被并发删除）或其他异常时跳过该子树，
   * 其余域行照常返回，不再一个子树失败拖垮整树（ok:false 整树空白）。
   */
    async list(req: PhysicalListRequest): Promise<IpcResult<WorkplaceListRowDto[]>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const vfs = ResolveVfsScope.getPhysicalVfs(rt);
            const isRoot = req.path === "/";
            const scopeDirs = isRoot ? ROOT_SCOPE_DIRS : [req.path];
            const rows: WorkplaceListRowDto[] = [];
            if (isRoot) {
                // 三个挂载点根目录行自身（listTree 不含查询根行，补齐供面板顶层展示）
                for (const dir of ROOT_SCOPE_DIRS) {
                    rows.push(Physical.toPhysicalRow({ path: dir, kind: "directory" }));
                }
            }
            for (const scopeDir of scopeDirs) {
                const listed = await vfs.listTree(scopeDir);
                if (!listed.ok) {
                    // vfsNotFound：子树已不存在（如项目被并发删除）→ 跳过该子树；
                    // 其他失败同样降级跳过（不中断整树），留 warn 便于排查。
                    if (!AppErrorOps.is(listed.error, "VFS_NOT_FOUND")) {
                        log.warn("physical-list 子树拉取失败，已跳过", { scopeDir, error: listed.error });
                    }
                    continue;
                }
                rows.push(...listed.value.map((entry) => Physical.toPhysicalRow(entry)));
            }
            return { ok: true, data: rows };
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    },

    /** 读物理路径文件内容：前缀解析后走对应域单 scope read（只读，无保存通道）。 */
    async read(req: PhysicalReadRequest): Promise<IpcResult<VfsReadResultDto>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const result = await ResolveVfsScope.getPhysicalVfs(rt).read(req.path);
            if (!result.ok) return IpcResults.err(FormatIpcError.format(result.error));
            return {
                ok: true,
                data: {
                    content: result.value.content,
                    version: result.value.version,
                    mtimeMs: result.value.mtimeMs,
                },
            };
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    },
} as const;
