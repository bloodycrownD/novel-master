/**
 * AST and public API types for SQL template parsing.
 */

/** Result of parsing a template with bound parameters. */
export interface SqlParseResult {
  sql: string;
  parameters: unknown[];
}

/** Options for {@link SqlTemplateParser}. */
export interface ParseOptions {
  /** Placeholder for `#{...}` bindings. Default `"?"`. */
  placeholder?: string;
}

/** Attributes on a `<foreach>` tag. */
export interface ForeachAttrs {
  collection: string;
  item: string;
  index?: string;
  open?: string;
  close?: string;
  separator?: string;
}

/** Attributes on a `<trim>` tag. */
export interface TrimAttrs {
  prefix?: string;
  suffix?: string;
  prefixOverrides?: string;
  suffixOverrides?: string;
}

/** AST node discriminated union. */
export type AstNode =
  | { type: "text"; value: string }
  | { type: "bind"; kind: "hash" | "dollar"; path: string }
  | { type: "if"; test: string; testOffset?: number; children: AstNode[] }
  | { type: "where"; children: AstNode[] }
  | { type: "foreach"; attrs: ForeachAttrs; children: AstNode[] }
  | { type: "trim"; attrs: TrimAttrs; children: AstNode[] }
  | {
      type: "choose";
      whens: { test: string; testOffset?: number; children: AstNode[] }[];
      otherwise?: AstNode[];
    };
