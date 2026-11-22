/**
 * Workplace IPC handlers — buildListRows, directory/file rules.
 *
 * @module ipc/handlers/workplace
 */
import type {
    IpcResult,
    WorkplaceBuildListRowsRequest,
    WorkplaceGetDirRuleRequest,
    WorkplaceListRowDto,
    WorkplaceSetDirRuleRequest,
    WorkplaceSetFileRuleRequest,
} from "../../../../shared/ipc-types.js";
import { RuleSnapshot } from "@novel-master/core/workplace";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { ResolveVfsScope } from "../resolve-vfs-scope.js";
import { WorkspaceMutatedForwarder } from "../forward-workspace-mutated.js";
import { FormatIpcError } from "../format-ipc-error.js";
import { IpcResults } from "../ipc-result.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";

export const Workplace = {
    /**
   * 规则保存后：evaluate→写 rule_snapshot canon→clear file_cache。
   * workplace 差集 suggest 已废止。
   *
   * 镜像注：mobile 同名入口在 apps/mobile/src/services/workplace-rule-delta-draft.service.ts。
   * 两端形态不同（本端先从 IPC 请求解析 scope 并带空参守卫，mobile 由调用方传入已解析的
   * workplace/sessionId），共同语义只有 core 的 RuleSnapshot.refresh 调用，故不收敛。
   */
    async refreshRuleSnapshotAfterRuleChange(rt: DesktopNovelMasterRuntime, req: { projectId?: string; sessionId?: string }): Promise<void> {
        if (req.sessionId == null || req.sessionId === "" || req.projectId == null || req.projectId === "") {
            return;
        }
        await RuleSnapshot.refresh(req.sessionId, {
            sessionKkv: rt.sessionKkv,
            workplace: rt.workplace({
                kind: "session",
                projectId: req.projectId,
                sessionId: req.sessionId,
            }),
        });
    },

    async buildListRows(req: WorkplaceBuildListRowsRequest): Promise<IpcResult<WorkplaceListRowDto[]>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const scopeRes = ResolveVfsScope.fromRequest(req);
            if (!scopeRes.ok) return scopeRes;
            const wt = ResolveVfsScope.getWorkplaceForScope(rt, scopeRes.data);
            const rows = await wt.buildListRows();
            if (!rows.ok) return IpcResults.err(FormatIpcError.format(rows.error));
            return { ok: true, data: rows.value };
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    },

    async setDirRule(req: WorkplaceSetDirRuleRequest): Promise<IpcResult<void>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const scopeRes = ResolveVfsScope.fromRequest(req);
            if (!scopeRes.ok) return scopeRes;
            const scope = scopeRes.data;
            const wt = ResolveVfsScope.getWorkplaceForScope(rt, scope);
            await wt.setDirRule({
                logicalPath: req.logicalPath,
                ruleEnabled: req.ruleEnabled,
                sortField: req.sortField,
                sortOrder: req.sortOrder,
                headCount: req.headCount,
                tailCount: req.tailCount,
                fillPolicy: req.fillPolicy,
            });
            WorkspaceMutatedForwarder.notify(WorkspaceMutatedForwarder.payloadFromRequest(req));
            await Workplace.refreshRuleSnapshotAfterRuleChange(rt, req);
            return { ok: true, data: undefined };
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    },

    async setFileRule(req: WorkplaceSetFileRuleRequest): Promise<IpcResult<void>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const scopeRes = ResolveVfsScope.fromRequest(req);
            if (!scopeRes.ok) return scopeRes;
            const scope = scopeRes.data;
            const wt = ResolveVfsScope.getWorkplaceForScope(rt, scope);
            await wt.setFileRule({
                logicalPath: req.logicalPath,
                inclusionMode: req.inclusionMode,
            });
            WorkspaceMutatedForwarder.notify(WorkspaceMutatedForwarder.payloadFromRequest(req));
            await Workplace.refreshRuleSnapshotAfterRuleChange(rt, req);
            return { ok: true, data: undefined };
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    },

    async getDirRule(req: WorkplaceGetDirRuleRequest): Promise<IpcResult<WorkplaceSetDirRuleRequest | null>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const scopeRes = ResolveVfsScope.fromRequest(req);
            if (!scopeRes.ok) return scopeRes;
            const scope = scopeRes.data;
            const wt = ResolveVfsScope.getWorkplaceForScope(rt, scope);
            const rule = await wt.getDirRule(req.logicalPath);
            if (!rule.ok) return IpcResults.err(FormatIpcError.format(rule.error));
            if (rule.value == null) {
                return { ok: true, data: null };
            }
            const rawFillPolicy = rule.value.fillPolicy;
            let fillPolicy: WorkplaceSetDirRuleRequest["fillPolicy"];
            if (rawFillPolicy === "full") {
                fillPolicy = "hidden";
            } else if (rawFillPolicy === "hidden" || rawFillPolicy === "filename" || rawFillPolicy === "header") {
                fillPolicy = rawFillPolicy;
            }
            return {
                ok: true,
                data: {
                    workspaceScope: req.workspaceScope,
                    projectId: req.projectId,
                    sessionId: req.sessionId,
                    logicalPath: rule.value.logicalPath,
                    ruleEnabled: rule.value.ruleEnabled,
                    sortField: rule.value.sortField,
                    sortOrder: rule.value.sortOrder,
                    headCount: rule.value.headCount,
                    tailCount: rule.value.tailCount,
                    fillPolicy,
                },
            };
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    },
} as const;
