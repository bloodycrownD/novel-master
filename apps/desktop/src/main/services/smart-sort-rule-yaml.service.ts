/**
 * Smart sort rule YAML import/export via Electron dialog (spec D10).
 *
 * encode/decode 单源在 core（`smart-sort-rule-io.ts`），本层只负责
 * 系统对话框编排与文本 (de)serialization；导入为替换式
 * （清空全部 → 按文件顺序全量插入），确认在 renderer 侧前置。
 *
 * @module services/smart-sort-rule-yaml
 */
import { parseText, stringifyText } from "@novel-master/core";
import type { BrowserWindow } from "electron";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import {
  exportYamlWithDialog,
  importYamlWithDialog,
  normalizeYamlError,
} from "./yaml-shared.js";

const EXPORT_FILE_NAME = "smart-sort-rules.yaml";

export async function exportSmartSortRuleYamlWithDialog(
  runtime: DesktopNovelMasterRuntime,
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  const doc = await runtime.smartSortRule.exportRules();
  const yaml = stringifyText(doc, "yaml");
  return exportYamlWithDialog(yaml, EXPORT_FILE_NAME, parentWindow);
}

export async function importSmartSortRuleYamlWithDialog(
  runtime: DesktopNovelMasterRuntime,
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  return importYamlWithDialog(async (yaml) => {
    try {
      // service.importRules 内部走 core 单源 decode（含 zod 校验）。
      await runtime.smartSortRule.importRules(parseText(yaml, "yaml"));
    } catch (error) {
      throw normalizeYamlError(error, "智能排序规则 YAML 无效");
    }
  }, parentWindow);
}
