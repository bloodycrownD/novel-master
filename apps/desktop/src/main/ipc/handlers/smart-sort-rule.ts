/**
 * Smart sort rule IPC handlers (spec Step 10).
 *
 * 各 handler 仅做 IpcResult 包装并转调 `rt.smartSortRule`
 * （core `SmartSortRuleService`）；YAML 导入导出经
 * `smart-sort-rule-yaml.service` 走系统对话框。
 */
import type {
  IpcResult,
  SmartSortRuleBundleDto,
  SmartSortRuleCreateRequest,
  SmartSortRuleDeleteBatchRequest,
  SmartSortRuleDto,
  SmartSortRuleIdRequest,
  SmartSortRuleImportRulesRequest,
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
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  exportSmartSortRuleYamlWithDialog,
  importSmartSortRuleYamlWithDialog,
} from "../../services/smart-sort-rule-yaml.service.js";
import { formatIpcError } from "../ipc-error.js";

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}

export async function handleSmartSortRuleList(): Promise<
  IpcResult<SmartSortRuleDto[]>
> {
  try {
    const rt = await getDesktopRuntime();
    const rules = await rt.smartSortRule.listRules();
    return { ok: true, data: rules as SmartSortRuleDto[] };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleCreate(
  req: SmartSortRuleCreateRequest,
): Promise<IpcResult<SmartSortRuleDto>> {
  try {
    const rt = await getDesktopRuntime();
    const rule = await rt.smartSortRule.createRule({
      name: req.name,
      pattern: req.pattern,
      ...(req.flags != null ? { flags: req.flags } : {}),
      ...(req.description != null ? { description: req.description } : {}),
      ...(req.enabled != null ? { enabled: req.enabled } : {}),
    });
    return { ok: true, data: rule as SmartSortRuleDto };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleUpdate(
  req: SmartSortRuleUpdateRequest,
): Promise<IpcResult<SmartSortRuleDto>> {
  try {
    const rt = await getDesktopRuntime();
    const rule = await rt.smartSortRule.updateRule(req.ruleId, req.patch);
    return { ok: true, data: rule as SmartSortRuleDto };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleDelete(
  req: SmartSortRuleIdRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.smartSortRule.deleteRule(req.ruleId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleDeleteBatch(
  req: SmartSortRuleDeleteBatchRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.smartSortRule.deleteBatch(req.ruleIds);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleSetEnabled(
  req: SmartSortRuleSetEnabledRequest,
): Promise<IpcResult<SmartSortRuleDto>> {
  try {
    const rt = await getDesktopRuntime();
    const rule = await rt.smartSortRule.setEnabled(req.ruleId, req.enabled);
    return { ok: true, data: rule as SmartSortRuleDto };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleSetEnabledBatch(
  req: SmartSortRuleSetEnabledBatchRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.smartSortRule.setEnabledBatch(req.ruleIds, req.enabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleMove(
  req: SmartSortRuleMoveRequest,
): Promise<IpcResult<SmartSortRuleDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const rules = await rt.smartSortRule.moveRule(req.ruleId, req.to);
    return { ok: true, data: rules as SmartSortRuleDto[] };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleReorder(
  req: SmartSortRuleReorderRequest,
): Promise<IpcResult<SmartSortRuleDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const rules = await rt.smartSortRule.reorderRules(req.orderedIds);
    return { ok: true, data: rules as SmartSortRuleDto[] };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleExportRules(): Promise<
  IpcResult<SmartSortRuleBundleDto>
> {
  try {
    const rt = await getDesktopRuntime();
    const bundle = await rt.smartSortRule.exportRules();
    return { ok: true, data: bundle as SmartSortRuleBundleDto };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleImportRules(
  req: SmartSortRuleImportRulesRequest,
): Promise<IpcResult<SmartSortRuleDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const rules = await rt.smartSortRule.importRules(req.bundle);
    return { ok: true, data: rules as SmartSortRuleDto[] };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleResetDefaults(): Promise<
  IpcResult<void>
> {
  try {
    const rt = await getDesktopRuntime();
    await rt.smartSortRule.resetDefaults();
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 正则匹配测试（fix ②：替代旧排序预览）：直调 core 纯函数，不走 runtime。
 * 非法正则是合法测试结局（ok:false 内联错误文案，不作 IPC 失败）。
 */
export async function handleSmartSortRuleMatch(
  req: SmartSortRuleMatchRequest,
): Promise<IpcResult<SmartSortRuleMatchResultDto>> {
  try {
    const result = matchSmartSortPattern(req.pattern, req.flags, req.text);
    return { ok: true, data: result as SmartSortRuleMatchResultDto };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleYamlExport(): Promise<
  IpcResult<SmartSortRuleYamlExportResult>
> {
  try {
    const rt = await getDesktopRuntime();
    const result = await exportSmartSortRuleYamlWithDialog(rt, parentWindow());
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSmartSortRuleYamlImport(): Promise<
  IpcResult<SmartSortRuleYamlImportResult>
> {
  try {
    const rt = await getDesktopRuntime();
    const result = await importSmartSortRuleYamlWithDialog(rt, parentWindow());
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
