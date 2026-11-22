/**
 * 从 `<action name="…">` JSON 推导 tool 名与 input。
 *
 * XML 结构解析统一在 `user-vfs-action-xml.ts`；本模块只做领域映射。
 *
 * @module domain/vfs/logic/action-xml-to-tool-uses
 */

import { Coerce } from "@/common/coerce.js";
import { UserVfsActionXml } from "./user-vfs-action-xml.js";

export interface DerivedToolUseInput {
    readonly name: string;
    readonly input: Record<string, unknown>;
}

export const ActionXmlToolUses = {
    /** 解析 action XML 字符串，按序返回推导的 tool 名与 input（不含 id）。 */
    toToolUses: (actionXml: string): DerivedToolUseInput[] => {
        const results: DerivedToolUseInput[] = [];
        for (const action of UserVfsActionXml.parseFromText(actionXml)) {
            const params = action.params;
            switch (action.name) {
                case "write":
                    results.push({ name: "write", input: { path: Coerce.string(params.path), content: Coerce.string(params.content) } });
                    break;
                case "edit":
                    results.push({ name: "edit", input: { path: Coerce.string(params.path), oldString: Coerce.string(params.oldString), newString: Coerce.string(params.newString) } });
                    break;
                case "mkdir":
                    results.push({ name: "fs", input: { action: "mkdir", path: Coerce.string(params.path) } });
                    break;
                case "delete":
                    results.push({ name: "fs", input: { action: "rm", path: Coerce.string(params.path), recursive: params.recursive === true || params.recursive === "true" } });
                    break;
                case "rename":
                case "move":
                    results.push({ name: "fs", input: { action: "mv", from: Coerce.string(params.from), to: Coerce.string(params.to) } });
                    break;
            }
        }
        return results;
    },
} as const;
