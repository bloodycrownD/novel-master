/**
 * Agent YAML import/export via Electron dialog.
 *
 * 文本编解码单源在 core（`@novel-master/core/agent` 的 `decodeAgentYamlText` /
 * `encodeAgentYamlText`）；本模块只保留对话框编排与 registry 落库。
 *
 * @module services/agent-yaml
 */
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { decodeAgentYamlText, encodeAgentYamlText, validateAgentDefinition } from "@novel-master/core/agent";
import { Errors } from "@novel-master/core/common";
import { Result } from "@novel-master/core/errors";
import type { BrowserWindow } from "electron";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { exportYamlWithDialog, importYamlWithDialog } from "./yaml-shared.js";

export async function exportAgentYamlWithDialog(runtime: DesktopNovelMasterRuntime, agentId: string, parentWindow?: BrowserWindow | null): Promise<"saved" | "cancelled"> {
  const def = await runtime.agentRegistry.get(agentId);
  if (!def.ok) {
    // 导出调用方只有 throw 通道：registry 已知失败转 throw，由 caller catch 收口。
    const failure = def.error;
    throw failure;
  }
  const yaml = encodeAgentYamlText(def.value);
  return exportYamlWithDialog(yaml, `${agentId}.agent.yaml`, parentWindow);
}

export async function importAgentYamlWithDialog(runtime: DesktopNovelMasterRuntime, agentId: string, parentWindow?: BrowserWindow | null): Promise<Result<"imported" | "cancelled", Error>> {
  return importYamlWithDialog(async (yaml) => {
    try {
      const defR = decodeAgentYamlText(yaml);
      // consume 回调与 mobile 同通道（Result）：已知失败过 Errors.normalizeYaml 贴标签回传。
      if (!defR.ok) return Result.err(Errors.normalizeYaml(defR.error, "Agent YAML 无效"));
      const def = defR.value;
      const probe = new ToolRegistry();
      registerBuiltinTools(probe);
      const validation = await validateAgentDefinition(def, { registeredToolNames: probe.list() });
      if (!validation.ok) return Result.err(Errors.normalizeYaml(validation.error, "Agent YAML 无效"));
      const saved = await runtime.agentRegistry.upsert(agentId, def, { registeredToolNames: probe.list() });
      if (!saved.ok) return Result.err(Errors.normalizeYaml(saved.error, "Agent YAML 无效"));
      return Result.ok(undefined);
    } catch (error) {
      // registry/校验链的意外抛出同样贴标签后走 Result；已贴标签的产物不会二次进入本分支
      // （本函数不再 throw 已知失败），故无需旧的「前缀已存在则放行」守卫。
      return Result.err(Errors.normalizeYaml(error, "Agent YAML 无效"));
    }
  }, parentWindow);
}
