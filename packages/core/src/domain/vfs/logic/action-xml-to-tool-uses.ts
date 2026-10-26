/**
 * 从 `<action name="…">` JSON 推导 tool 名与 input。
 *
 * XML 结构解析统一在 `user-vfs-action-xml.ts`；本模块只做领域映射。
 *
 * @module domain/vfs/logic/action-xml-to-tool-uses
 */

import { parseUserVfsActionsFromText } from "./user-vfs-action-xml.js";

export interface DerivedToolUseInput {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** 解析 action XML 字符串，按序返回推导的 tool 名与 input（不含 id）。 */
export function actionXmlToToolUses(actionXml: string): DerivedToolUseInput[] {
  const results: DerivedToolUseInput[] = [];
  for (const action of parseUserVfsActionsFromText(actionXml)) {
    const params = action.params;
    switch (action.name) {
      case "write":
        results.push({ name: "write", input: { path: asString(params.path), content: asString(params.content) } });
        break;
      case "edit":
        results.push({ name: "edit", input: { path: asString(params.path), oldString: asString(params.oldString), newString: asString(params.newString) } });
        break;
      case "mkdir":
        results.push({ name: "fs", input: { action: "mkdir", path: asString(params.path) } });
        break;
      case "delete":
        results.push({ name: "fs", input: { action: "rm", path: asString(params.path), recursive: params.recursive === true || params.recursive === "true" } });
        break;
      case "rename":
      case "move":
        results.push({ name: "fs", input: { action: "mv", from: asString(params.from), to: asString(params.to) } });
        break;
    }
  }
  return results;
}
