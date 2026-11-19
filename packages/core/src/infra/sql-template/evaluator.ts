/**
 * SQL template evaluator (phase 2): walks AST with a context stack.
 * Produces final SQL text and ordered parameters for prepared statements.
 */

import { SqlTemplateContext, type ContextStack } from "./context.js";
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

  evaluate(nodes: AstNode[], params: Record<string, unknown>): SqlParseResult {
    const stack: ContextStack = [params];
    const state: EvaluateState = { parts: [], parameters: [] };
    this.evaluateNodes(nodes, stack, state);
    return {
      sql: state.parts.join(""),
      parameters: state.parameters,
    };
  }

  private evaluateNodes(nodes: AstNode[], stack: ContextStack, state: EvaluateState): void {
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
        case "if":
          if (SqlTemplateExpression.evaluateTest(node.test, stack, { offset: node.testOffset })) {
            this.evaluateNodes(node.children, stack, state);
          }
          break;
        case "where": {
          const innerState: EvaluateState = { parts: [], parameters: [] };
          this.evaluateNodes(node.children, stack, innerState);
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

          items.forEach((item, index) => {
            const frame: Record<string, unknown> = {
              [node.attrs.item]: item,
            };
            if (node.attrs.index) {
              frame[node.attrs.index] = index;
            }
            const childStack = SqlTemplateContext.pushScope(stack, frame);
            const chunkState: EvaluateState = { parts: [], parameters: [] };
            this.evaluateNodes(node.children, childStack, chunkState);
            state.parameters.push(...chunkState.parameters);
            chunks.push(chunkState.parts.join(""));
          });

          state.parts.push(open + chunks.join(separator) + close);
          break;
        }
        case "trim": {
          const innerState: EvaluateState = { parts: [], parameters: [] };
          this.evaluateNodes(node.children, stack, innerState);
          state.parameters.push(...innerState.parameters);
          state.parts.push(SqlTemplateTrim.applyOverrides(innerState.parts.join(""), node.attrs));
          break;
        }
        case "choose": {
          let matched = false;
          for (const when of node.whens) {
            if (SqlTemplateExpression.evaluateTest(when.test, stack, { offset: when.testOffset })) {
              this.evaluateNodes(when.children, stack, state);
              matched = true;
              break;
            }
          }
          if (!matched && node.otherwise) {
            this.evaluateNodes(node.otherwise, stack, state);
          }
          break;
        }
        default: {
          const _exhaustive: never = node;
          return _exhaustive;
        }
      }
    }
  }
}
