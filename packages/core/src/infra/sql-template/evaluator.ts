/**
 * SQL template evaluator (phase 2): walks AST with a context stack.
 * Produces final SQL text and ordered parameters for prepared statements.
 */

import { Result } from "@/errors/either.js";
import { SqlTemplateContext, type ContextStack } from "./context.js";
import { SqlTemplateError } from "./errors.js";
import { SqlTemplateExpression } from "./expression.js";
import { SqlTemplatePlaceholder } from "./placeholder.js";
import { SqlTemplateForeach } from "./tags/foreach.js";
import { SqlTemplateTrim } from "./tags/trim.js";
import { SqlTemplateWhere } from "./tags/where.js";
import type { AstNode } from "./types.js";
import type { SqlParseResult } from "./types.js";

interface EvaluateState {
    parts: string[];
    parameters: unknown[];
}

/**
 * Evaluates an AST against runtime parameters.
 */
export class TemplateEvaluator {
    constructor(private readonly placeholder: string) {}

    evaluate(nodes: AstNode[], params: Record<string, unknown>): Result<SqlParseResult, SqlTemplateError> {
        const stack: ContextStack = [params];
        const state: EvaluateState = { parts: [], parameters: [] };
        const evaluated = this.evaluateNodes(nodes, stack, state);
        if (!evaluated.ok) return Result.err(evaluated.error);
        return Result.ok({ sql: state.parts.join(""), parameters: state.parameters });
    }

    private evaluateNodes(nodes: AstNode[], stack: ContextStack, state: EvaluateState): Result<null, SqlTemplateError> {
        for (const node of nodes) {
            switch (node.type) {
                case "text":
                    state.parts.push(node.value);
                    break;
                case "bind": {
                    const { fragment, parameters } = SqlTemplatePlaceholder.renderBind(node.kind, node.path, stack, this.placeholder);
                    state.parts.push(fragment);
                    state.parameters.push(...parameters);
                    break;
                }
                case "if": {
                    const test = SqlTemplateExpression.evaluateTest(node.test, stack, { offset: node.testOffset });
                    if (!test.ok) return Result.err(test.error);
                    if (test.value) {
                        const children = this.evaluateNodes(node.children, stack, state);
                        if (!children.ok) return Result.err(children.error);
                    }
                    break;
                }
                case "where": {
                    const innerState: EvaluateState = { parts: [], parameters: [] };
                    const children = this.evaluateNodes(node.children, stack, innerState);
                    if (!children.ok) return Result.err(children.error);
                    state.parameters.push(...innerState.parameters);
                    const wrapped = SqlTemplateWhere.wrap(innerState.parts.join(""));
                    if (wrapped) state.parts.push(wrapped);
                    break;
                }
                case "foreach": {
                    const collection = SqlTemplateContext.resolvePath(stack, node.attrs.collection);
                    const items = SqlTemplateForeach.normalizeCollection(collection);
                    if (items.length === 0) break;

                    const open = node.attrs.open ?? "";
                    const close = node.attrs.close ?? "";
                    const separator = node.attrs.separator ?? "";
                    const chunks: string[] = [];

                    // forEach 回调无法短路递归失败，改下标循环保持迭代顺序不变。
                    for (let index = 0; index < items.length; index++) {
                        const item = items[index];
                        const frame: Record<string, unknown> = {
                            [node.attrs.item]: item,
                        };
                        if (node.attrs.index) {
                            frame[node.attrs.index] = index;
                        }
                        const childStack = SqlTemplateContext.pushScope(stack, frame);
                        const chunkState: EvaluateState = { parts: [], parameters: [] };
                        const chunk = this.evaluateNodes(node.children, childStack, chunkState);
                        if (!chunk.ok) return Result.err(chunk.error);
                        state.parameters.push(...chunkState.parameters);
                        chunks.push(chunkState.parts.join(""));
                    }

                    state.parts.push(open + chunks.join(separator) + close);
                    break;
                }
                case "trim": {
                    const innerState: EvaluateState = { parts: [], parameters: [] };
                    const children = this.evaluateNodes(node.children, stack, innerState);
                    if (!children.ok) return Result.err(children.error);
                    state.parameters.push(...innerState.parameters);
                    state.parts.push(SqlTemplateTrim.applyOverrides(innerState.parts.join(""), node.attrs));
                    break;
                }
                case "choose": {
                    let matched = false;
                    for (const when of node.whens) {
                        const test = SqlTemplateExpression.evaluateTest(when.test, stack, { offset: when.testOffset });
                        if (!test.ok) return Result.err(test.error);
                        if (test.value) {
                            const children = this.evaluateNodes(when.children, stack, state);
                            if (!children.ok) return Result.err(children.error);
                            matched = true;
                            break;
                        }
                    }
                    if (!matched && node.otherwise) {
                        const children = this.evaluateNodes(node.otherwise, stack, state);
                        if (!children.ok) return Result.err(children.error);
                    }
                    break;
                }
                default: {
                    const _exhaustive: never = node;
                    return _exhaustive;
                }
            }
        }
        return Result.ok(null);
    }
}
