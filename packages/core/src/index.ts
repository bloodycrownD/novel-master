export const PACKAGE_NAME = "@novel-master/core";

export function greet(name: string): string {
  return `Hello, ${name} from ${PACKAGE_NAME}`;
}

export {
  SqlTemplateParser,
  SqlTemplateError,
  parseTemplateToAst,
  normalizeExpression,
  evaluateTest,
} from "./infra/sql-template/index.js";
export type {
  SqlParseResult,
  ParseOptions,
  SqlTemplateErrorCode,
  AstNode,
} from "./infra/sql-template/index.js";
