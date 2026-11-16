/**
 * Smart sort rule IPC handlers (spec Step 10).
 *
 * 各 handler 收成 `toIpcResult` 的 thunk 形态并转调 `rt.smartSortRule`
 * （core `SmartSortRuleService`）；已知失败沿 `Result` 到达、未知异常
 * 就地转码（错误通道迁移四期）。YAML 导入导出经
 * `smart-sort-rule-yaml.service` 走系统对话框。
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
import { matchSmartSortPattern } from "@novel-master/core/smart-sort-rule";
import { type AppError, Result } from "@novel-master/core/errors";
import { coreT } from "../../../../shared/logic/core-i18n.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  exportSmartSortRuleYamlWithDialog,
  importSmartSortRuleYamlWithDialog,
} from "../../services/smart-sort-rule-yaml.service.js";
import { toIpcResult } from "../ipc-result.js";

export async function handleSmartSortRuleList(): Promise<IpcResult<SmartSortRuleDto[]>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    return Result.ok((await rt.smartSortRule.listRules()) as SmartSortRuleDto[]);
  });
}

export async function handleSmartSortRuleCreate(req: SmartSortRuleCreateRequest): Promise<IpcResult<SmartSortRuleDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
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

export async function handleSmartSortRuleUpdate(req: SmartSortRuleUpdateRequest): Promise<IpcResult<SmartSortRuleDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const rule = await rt.smartSortRule.updateRule(req.ruleId, req.patch);
    return rule.map((value) => value as SmartSortRuleDto);
  });
}

export async function handleSmartSortRuleDelete(req: SmartSortRuleIdRequest): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    return rt.smartSortRule.deleteRule(req.ruleId);
  });
}

export async function handleSmartSortRuleDeleteBatch(req: SmartSortRuleDeleteBatchRequest): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    return rt.smartSortRule.deleteBatch(req.ruleIds);
  });
}

export async function handleSmartSortRuleSetEnabled(req: SmartSortRuleSetEnabledRequest): Promise<IpcResult<SmartSortRuleDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const rule = await rt.smartSortRule.setEnabled(req.ruleId, req.enabled);
    return rule.map((value) => value as SmartSortRuleDto);
  });
}

export async function handleSmartSortRuleSetEnabledBatch(req: SmartSortRuleSetEnabledBatchRequest): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    await rt.smartSortRule.setEnabledBatch(req.ruleIds, req.enabled);
    return Result.ok(undefined);
  });
}

export async function handleSmartSortRuleMove(req: SmartSortRuleMoveRequest): Promise<IpcResult<SmartSortRuleDto[]>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const rules = await rt.smartSortRule.moveRule(req.ruleId, req.to);
    return rules.map((value) => value as SmartSortRuleDto[]);
  });
}

export async function handleSmartSortRuleReorder(req: SmartSortRuleReorderRequest): Promise<IpcResult<SmartSortRuleDto[]>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const rules = await rt.smartSortRule.reorderRules(req.orderedIds);
    return rules.map((value) => value as SmartSortRuleDto[]);
  });
}

export async function handleSmartSortRuleResetDefaults(): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
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
export async function handleSmartSortRuleMatch(req: SmartSortRuleMatchRequest): Promise<IpcResult<SmartSortRuleMatchResultDto>> {
  return toIpcResult(async (): Promise<Result<SmartSortRuleMatchResultDto, AppError>> => {
    const result = matchSmartSortPattern(req.pattern, req.flags, req.text, req.captureKind ?? "smart");
    if (!result.ok) return Result.ok({ ok: false as const, error: result.error });
    return Result.ok({
      ok: true as const,
      matches: result.matches.map((m) => ({ ...m, tuple: m.tuple == null ? null : coreT(m.tuple) })),
    });
  });
}

export async function handleSmartSortRuleYamlExport(): Promise<IpcResult<SmartSortRuleYamlExportResult>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    return Result.ok(await exportSmartSortRuleYamlWithDialog(rt, BrowserWindow.getFocusedWindow()));
  });
}

export async function handleSmartSortRuleYamlImport(): Promise<IpcResult<SmartSortRuleYamlImportResult>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    return Result.ok(await importSmartSortRuleYamlWithDialog(rt, BrowserWindow.getFocusedWindow()));
  });
}
