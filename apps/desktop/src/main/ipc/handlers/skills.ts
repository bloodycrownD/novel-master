/**
 * Skills IPC handlers：直调 runtime `skills()`（SkillService 端口）。
 *
 * 已知失败沿 `Result` 到达、未知异常就地转码，统一经 `toIpcResult`
 * 的 thunk 形态收口（错误通道迁移四期）。
 */
import type {
    EffectiveSkillDto,
    IpcResult,
    SkillListItemDto,
    SkillRefDto,
    SkillsAssertCreateNameRequest,
    SkillsDeleteRequest,
    SkillsEffectiveRequest,
    SkillsListRequest,
    SkillsReadRequest,
    SkillsReadResponse,
    SkillsToggleRequest,
    SkillsUpdateInfoRequest,
    SkillsWriteRequest,
} from "../../../../shared/ipc-types.js";
import { Outcome, Result, type AppError } from "@novel-master/core/errors";
import { AssertionError } from "@novel-master/core/common";
import type { SkillListItem, SkillListScope, SkillLocation } from "@novel-master/core/skills";
import { coreT } from "../../../../shared/logic/core-i18n.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { IpcResults } from "../ipc-result.js";

export namespace Skills {
    function toSkillLocation(ref: SkillRefDto): SkillLocation {
        return {
            domain: ref.domain,
            ...(ref.projectId != null ? { projectId: ref.projectId } : {}),
            name: ref.name,
        };
    }

    export async function list(req: SkillsListRequest): Promise<IpcResult<SkillListItemDto[]>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const scope: SkillListScope = req.domain === "global" ? "global" : { projectId: req.projectId ?? "" };
            // listSkills 走 Outcome：failed 归 Result.err；本 handler 不注入 hooks，
            // cancelled/replaced 不可达，命中即不变量破坏（断言而非取消语义）。
            // 显式标注 R（与 core skill-tool 同款）：否则轮询式推断会把 completed 分支的
            // `Result<T, never>` 当成唯一候选，failed 分支被误判为不可赋值。
            const listed = Outcome.match<SkillListItem[], Result<SkillListItem[], AppError>>(await rt.skills().listSkills(scope), {
                completed: (items) => Result.ok(items),
                cancelled: () => { throw new AssertionError("Skills.list 未注入 hooks，listSkills 不应产生 cancelled"); },
                replaced: () => { throw new AssertionError("Skills.list 未注入 hooks，listSkills 不应产生 replaced"); },
                failed: (error) => Result.err(error),
            });
            return listed.map((items) => items.map((item) => ({
                name: item.name,
                description: item.description,
                domain: item.domain,
                valid: item.valid,
                ...(item.invalidReason != null ? { invalidReason: coreT(item.invalidReason) } : {}),
                files: [...item.files],
            })));
        });
    }

    export async function effective(req: SkillsEffectiveRequest): Promise<IpcResult<EffectiveSkillDto[]>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const effective = await rt.skills().effectiveSkills(req.projectId);
            return effective.map((rows) => rows.map((row) => ({
                name: row.name,
                description: row.description,
                domain: row.domain,
                overridden: row.overridden,
                disabled: row.disabled,
                valid: row.valid,
                ...(row.invalidReason != null ? { invalidReason: coreT(row.invalidReason) } : {}),
                effective: row.effective,
            })));
        });
    }

    export async function read(req: SkillsReadRequest): Promise<IpcResult<SkillsReadResponse>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const file = await rt.skills().readSkillFile(req.domain, req.name, req.path, req.projectId);
            return file.map((f) => ({
                domain: f.domain,
                name: f.name,
                path: f.path,
                content: f.content,
                version: f.version,
            }));
        });
    }

    export async function write(req: SkillsWriteRequest): Promise<IpcResult<{ version: number }>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.skills().writeSkillFile({ domain: req.domain, name: req.name, path: req.path, content: req.content, projectId: req.projectId });
        });
    }

    export async function toggle(req: SkillsToggleRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.skills().setDisabled(req.projectId, req.name, req.disabled);
        });
    }

    export async function remove(req: SkillsDeleteRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.skills().deleteSkill(toSkillLocation(req));
        });
    }

    /** 新建前保留名校验（D2② 门独立暴露）：拒绝时 message 已是中文文案。 */
    export async function assertCreateName(req: SkillsAssertCreateNameRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.skills().assertSkillNameNotReservedForCreate(req.domain, req.name, req.projectId);
        });
    }

    /** 编辑技能信息（重命名 + 描述同一提交）：错误码与中文文案透传。 */
    export async function updateInfo(req: SkillsUpdateInfoRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.skills().updateSkillInfo(toSkillLocation(req), {
                ...(req.newName != null ? { newName: req.newName } : {}),
                ...(req.description != null ? { description: req.description } : {}),
            });
        });
    }
}
