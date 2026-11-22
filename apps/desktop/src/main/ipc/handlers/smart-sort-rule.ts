/**
 * Smart sort rule IPC handlers (spec Step 10).
 *
 * 各 handler 收成 `toIpcResult` 的 thunk 形态并转调 `rt.smartSortRule`
 * （core `SmartSortRuleService`）；已知失败沿 `Result` 到达、未知异常
 * 就地转码（错误通道迁移四期）。YAML 导入导出走系统对话框
 * （encode/decode 单源在 core `smart-sort-rule-io.ts`）。
 */
import type {
    IpcResult,
    SmartSortRuleCreateRequest,
    SmartSortRuleDeleteBatchRequest,
    SmartSortRuleDto,
    SmartSortRuleIdRequest,
    SmartSortRuleMatchRequest,
    SmartSortRuleMatchResultDto,
    SmartSortRuleMoveRequest,
    SmartSortRuleReorderRequest,
    SmartSortRuleSetEnabledBatchRequest,
    SmartSortRuleSetEnabledRequest,
    SmartSortRuleUpdateRequest,
    SmartSortRuleYamlExportResult,
    SmartSortRuleYamlImportResult,
} from "../../../../shared/ipc-types.js";
import { BrowserWindow } from "electron";
import { SerializationParseText, SerializationStringifyText } from "@novel-master/core";
import { Errors } from "@novel-master/core/common";
import { SmartSortPattern } from "@novel-master/core/smart-sort-rule";
import { type AppError, Result } from "@novel-master/core/errors";
import { coreT } from "../../../../shared/logic/core-i18n.js";
import { FormatIpcError } from "../format-ipc-error.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { YamlShared } from "../../services/yaml-shared.js";
import { IpcResults } from "../ipc-result.js";

/** 根目录导出的备用名：项目已删除或域无 projectId 时使用（原 smart-sort-rule-yaml.service 内联携带）。 */
const EXPORT_FILE_NAME = "smart-sort-rules.yaml";

export namespace SmartSortRule {
    export async function list(): Promise<IpcResult<SmartSortRuleDto[]>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return Result.ok((await rt.smartSortRule.listRules()) as SmartSortRuleDto[]);
        });
    }

    export async function create(req: SmartSortRuleCreateRequest): Promise<IpcResult<SmartSortRuleDto>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const patch = {
                name: req.name,
                pattern: req.pattern,
                ...(req.flags != null ? { flags: req.flags } : {}),
                ...(req.captureKind != null ? { captureKind: req.captureKind } : {}),
                ...(req.description != null ? { description: req.description } : {}),
                ...(req.enabled != null ? { enabled: req.enabled } : {}),
            };
            const rule = await rt.smartSortRule.createRule(patch);
            return rule.map((value) => value as SmartSortRuleDto);
        });
    }

    export async function update(req: SmartSortRuleUpdateRequest): Promise<IpcResult<SmartSortRuleDto>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const rule = await rt.smartSortRule.updateRule(req.ruleId, req.patch);
            return rule.map((value) => value as SmartSortRuleDto);
        });
    }

    export async function remove(req: SmartSortRuleIdRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.smartSortRule.deleteRule(req.ruleId);
        });
    }

    export async function deleteBatch(req: SmartSortRuleDeleteBatchRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.smartSortRule.deleteBatch(req.ruleIds);
        });
    }

    export async function setEnabled(req: SmartSortRuleSetEnabledRequest): Promise<IpcResult<SmartSortRuleDto>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const rule = await rt.smartSortRule.setEnabled(req.ruleId, req.enabled);
            return rule.map((value) => value as SmartSortRuleDto);
        });
    }

    export async function setEnabledBatch(req: SmartSortRuleSetEnabledBatchRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            await rt.smartSortRule.setEnabledBatch(req.ruleIds, req.enabled);
            return Result.ok(undefined);
        });
    }

    export async function move(req: SmartSortRuleMoveRequest): Promise<IpcResult<SmartSortRuleDto[]>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const rules = await rt.smartSortRule.moveRule(req.ruleId, req.to);
            return rules.map((value) => value as SmartSortRuleDto[]);
        });
    }

    export async function reorder(req: SmartSortRuleReorderRequest): Promise<IpcResult<SmartSortRuleDto[]>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const rules = await rt.smartSortRule.reorderRules(req.orderedIds);
            return rules.map((value) => value as SmartSortRuleDto[]);
        });
    }

    export async function resetDefaults(): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            await rt.smartSortRule.resetDefaults();
            return Result.ok(undefined);
        });
    }

    /**
   * 正则匹配测试（fix ②：替代旧排序预览）：直调 core 纯函数，不走 runtime。
   * tuple 在 core 侧是 MessageLike（fixed 档为 label descriptor）；DTO 契约是
   * string，翻译发生在 IPC 边界（main 侧 coreT），renderer 直接渲染。非法正则
   * 是合法测试结局：data 内联 ok:false + error，不升格为 IPC 错误。
   */
    export async function match(req: SmartSortRuleMatchRequest): Promise<IpcResult<SmartSortRuleMatchResultDto>> {
        return IpcResults.from(async (): Promise<Result<SmartSortRuleMatchResultDto, AppError>> => {
            const result = SmartSortPattern.match(req.pattern, req.flags, req.text, req.captureKind ?? "smart");
            if (!result.ok) return Result.ok({ ok: false as const, error: result.error });
            return Result.ok({
                ok: true as const,
                matches: result.matches.map((m) => ({ ...m, tuple: m.tuple == null ? null : coreT(m.tuple) })),
            });
        });
    }

    export async function exportYaml(): Promise<IpcResult<SmartSortRuleYamlExportResult>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            // 原 exportSmartSortRuleYamlWithDialog 内联：导出规则 → yaml → 保存框（导入为替换式，确认在 renderer 前置）。
            const doc = await rt.smartSortRule.exportRules();
            const yaml = SerializationStringifyText.stringify(doc, "yaml");
            return Result.ok(await YamlShared.exportWithDialog(yaml, EXPORT_FILE_NAME, BrowserWindow.getFocusedWindow()));
        });
    }

    export async function importYaml(): Promise<IpcResult<SmartSortRuleYamlImportResult>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            // 原 importSmartSortRuleYamlWithDialog 内联：service.importRules 内部走
            // core 单源 decode（含 zod 校验）。
            // nm-style: keep-local — 具名回调是 importYamlWithDialog 多行实参拆 VARDECL 的唯一出路；内联回调用点会让 consume 回调与窗口实参跨行（check-signatures ARGS），规则互斥（同 llm-sse-transport 先例）。
            // nm-style: keep-closure — 体仅约 10 行、单调用点，同款 consume 契约要求 yaml 末参回调形态，提升后 wrapper 不可免，收益为负。
            const importRulesFromYaml = async (yaml: string) => {
                try {
                    // ⚠️ 既有口径：返回值未检查（known-failure 也只当成功）——本轮只改通道形状，不动语义。
                    await built.value.smartSortRule.importRules(SerializationParseText.parse(yaml, "yaml"));
                    return Result.ok(undefined);
                } catch (error) {
                    // 存储/事务类故障原样上抛、其余套「YAML 无效」前缀——判据与前缀都在
                    // core 的 Errors.normalizeSmartSortImport 里（mobile 侧调同一个函数）。
                    return Result.err(Errors.normalizeSmartSortImport(error));
                }
            };
            const win = BrowserWindow.getFocusedWindow();
            const imported = await YamlShared.importWithDialog(importRulesFromYaml, win);
            // import 通道与 mobile 一致走 Result；载荷是 YAML 归一层的 Error，转码口径同旧 catch。
            if (!imported.ok) return { ok: false, error: FormatIpcError.format(imported.error) };
            return { ok: true, data: imported.value };
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }
}
