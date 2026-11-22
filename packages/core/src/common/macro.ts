/**
 * 文本模板宏原语：`{{ ... }}` 动作扫描（MacroScan）与 Go-style 字段宏替换
 * （MacroRender）。纯文本变换，与 prompt 业务无关（prompt-template 的
 * 原位是命名错挂，2026-11-23 上收 common）。
 *
 * @module common/macro
 */


import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

type MacroActionKind = "comment" | "dot" | "root";

interface MacroAction {
    readonly kind: MacroActionKind;
    readonly start: number;
    readonly end: number;
    /** Dot path segments (e.g. `worktree`, `a`, `b`) or root key after `$`. */
    readonly path: readonly string[];
}

const UNSUPPORTED_PATTERN = /\b(if|range|with|template|define)\b|:=|\|/;

/**
 * `{{ ... }}` 宏动作扫描。
 */
export const MacroScan = {
    /**
   * Returns macro actions in source order (comments included for span removal);
   * 残缺/非法模板是用户内容错误，沿 `Result.err` 回传，不抛。
   */
    scan(template: string): Result<readonly MacroAction[], AppError> {
        const actions: MacroAction[] = [];
        let i = 0;

        while (i < template.length) {
            const open = template.indexOf("{{", i);
            if (open < 0) {
                break;
            }

            if (template.startsWith("{{/*", open)) {
                const close = template.indexOf("*/}}", open + 4);
                if (close < 0) {
                    return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "unclosed macro comment", offset: open }));
                }
                const end = close + 4;
                actions.push({kind: "comment", start: open, end, path: [],});
                i = end;
                continue;
            }

            const close = template.indexOf("}}", open + 2);
            if (close < 0) {
                return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "unclosed macro", offset: open }));
            }

            const trimmed = template.slice(open + 2, close).trim();
            if (trimmed.length === 0) {
                return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "empty macro action", offset: open }));
            }
            if (trimmed.startsWith("/*")) {
                if (!trimmed.endsWith("*/")) {
                    return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "unclosed macro comment", offset: open }));
                }
                actions.push({ kind: "comment", start: open, end: close + 2, path: [] });
                i = close + 2;
                continue;
            }
            if (UNSUPPORTED_PATTERN.test(trimmed)) {
                return Result.err(new AppError("PROMPT_UNSUPPORTED_SYNTAX", { detail: `unsupported template syntax near offset ${open}`, offset: open }));
            }
            if (trimmed.startsWith(".")) {
                const parts = trimmed.slice(1).split(".");
                const path = parts.map((s) => s.trim()).filter((s) => s.length > 0);
                if (path.length === 0) {
                    return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: "empty dot path", offset: open }));
                }
                actions.push({ kind: "dot", start: open, end: close + 2, path });
                i = close + 2;
                continue;
            }
            if (trimmed.startsWith("$")) {
                const rest = trimmed.slice(1).trim();
                const key = rest.startsWith(".") ? rest.slice(1).trim() : rest;
                if (key.length === 0) {
                    return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: "empty root field", offset: open }));
                }
                if (key.includes(".")) {
                    return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown root field: $${key}`, offset: open }));
                }
                actions.push({ kind: "root", start: open, end: close + 2, path: [key] });
                i = close + 2;
                continue;
            }
            return Result.err(new AppError("PROMPT_UNSUPPORTED_SYNTAX", { detail: `unsupported macro action: ${trimmed}`, offset: open }));
        }

        return Result.ok(actions);
    },
} as const;


interface MacroRenderContext {
    readonly dot: Readonly<Record<string, unknown>>;
    readonly root: Readonly<Record<string, string>>;
    /** Dot fields that resolve to "" when missing. */
    readonly optionalDotFields?: readonly string[];
}

/**
 * `{{ ... }}` 宏渲染。
 */
export const MacroRender = {
    /**
   * Replaces `{{ ... }}` macros in `template` using dot and root contexts;
   * 模板引用了不存在的字段是用户内容错误，沿 `Result.err` 回传，不抛。
   */
    render(template: string, ctx: MacroRenderContext): Result<string, AppError> {
        const scanned = MacroScan.scan(template);
        if (!scanned.ok) {
            return Result.err(scanned.error);
        }
        const actions = scanned.value;
        if (actions.length === 0) {
            return Result.ok(template);
        }

        const optionalTopLevel = ctx.optionalDotFields != null ? new Set(ctx.optionalDotFields) : undefined;

        let out = "";
        let cursor = 0;

        for (const action of actions) {
            out += template.slice(cursor, action.start);

            if (action.kind === "comment") {
                cursor = action.end;
                continue;
            }

            let resolved: string;
            if (action.kind === "dot") {
                if (action.path.length === 1 && optionalTopLevel?.has(action.path[0]!) === true) {
                    const value = ctx.dot[action.path[0]!];
                    resolved = value == null || typeof value !== "string" ? "" : value;
                } else {
                    let current: unknown = ctx.dot;
                    for (const segment of action.path) {
                        if (current == null || typeof current !== "object" || Array.isArray(current)) {
                            return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown field: .${action.path.join(".")}`, offset: action.start }));
                        }
                        current = (current as Record<string, unknown>)[segment];
                    }
                    if (current == null) {
                        return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown field: .${action.path.join(".")}`, offset: action.start }));
                    }
                    if (typeof current !== "string") {
                        return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `field .${action.path.join(".")} is not a string`, offset: action.start }));
                    }
                    resolved = current;
                }
            } else {
                const value = ctx.root[action.path[0]!];
                if (value == null) {
                    return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown field: $.${action.path[0]!}`, offset: action.start }));
                }
                resolved = value;
            }
            out += resolved;

            cursor = action.end;
        }

        out += template.slice(cursor);
        return Result.ok(out);
    },
} as const;
