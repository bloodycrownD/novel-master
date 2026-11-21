/**
 * oop 规则：OOP 化候选（启发式，最后一步才看）——主仓 check-oop.mjs 原样迁移。
 * 只报两类：
 *   OOP_CANDIDATE — 多个导出函数读写同一份模块级可变状态（Map/Set/let）；
 *   MANY_EXPORTS  — 导出函数 >= 6（以旧脚本实现为准；旧注释写 ≥8 与实现不一致，本迁移修注释不改判据）。
 * 不自动建类：纯函数模块、DTO、hook、单个函数都不应因为「导出多」就 OOP。
 * verdict 语义（spec §3.3）：默认记录不阻断，`--strict` 才阻断——blocking 由 ctx.strict 计算，
 * KFP/suppress 在 cli 层照常生效（oop 在 KFP 值域内）。
 */

import path from "node:path";
import ts from "typescript";
import { lineOf, parseSource, toPosix } from "../lib/core.js";
import type { Finding } from "../lib/report.js";
import type { ScanEntry } from "./signatures.js";

export interface OopContext {
  entries: readonly ScanEntry[];
  /** true = --strict：候选行 blocking（阻断）；false = 只记录。 */
  strict?: boolean;
}

function isExported(node: ts.Node): boolean {
  // 旧脚本直接把 statement 传给 getCombinedModifierFlags；d.ts 里 Statement 不带 _declarationBrand，按其运行时语义在此 cast。
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function functionEntries(sourceFile: ts.SourceFile): Array<{ name: string; body: ts.Node }> {
  const entries: Array<{ name: string; body: ts.Node }> = [];
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name != null && statement.body != null) {
      entries.push({ name: statement.name.text, body: statement.body });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const init = declaration.initializer;
        if (init != null && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) entries.push({ name: declaration.name.text, body: init.body });
      }
    }
  }
  return entries;
}

function stateNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const init = declaration.initializer;
      const isLet = (statement.declarationList.flags & ts.NodeFlags.Let) !== 0;
      const isMutableContainer = init != null && ts.isNewExpression(init) && ts.isIdentifier(init.expression) && ["Map", "Set", "WeakMap", "WeakSet"].includes(init.expression.text);
      if (isLet || isMutableContainer) names.add(declaration.name.text);
    }
  }
  return names;
}

function usedStates(body: ts.Node, names: Set<string>): Set<string> {
  const used = new Set<string>();
  collectUsedStates(body, names, used);
  return used;
}

function collectUsedStates(node: ts.Node, names: Set<string>, used: Set<string>): void {
  if (ts.isIdentifier(node) && names.has(node.text)) {
    const parent = node.parent;
    const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node);
    const isDeclarationName = (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isParameter(parent)) && parent.name === node;
    if (!isPropertyName && !isDeclarationName) used.add(node.text);
  }
  ts.forEachChild(node, (child) => collectUsedStates(child, names, used));
}

/** 逐文件裁决（行=首条语句），verdict × location 排序与旧脚本一致；KEEP 文件不产出行。 */
export function scanOop(ctx: OopContext): Finding[] {
  const findings: Finding[] = [];
  for (const entry of ctx.entries) {
    const sourceFile = entry.text == null ? parseSource(entry.file) : parseText(entry.file, entry.text);
    const states = stateNames(sourceFile);
    const functions = functionEntries(sourceFile);
    const usage = new Map<string, string[]>();
    for (const fn of functions) {
      for (const state of usedStates(fn.body, states)) {
        const list = usage.get(state) ?? [];
        list.push(fn.name);
        usage.set(state, list);
      }
    }
    const shared = [...usage].filter(([, list]) => list.length >= 2);
    const functionsUsingState = new Set(shared.flatMap(([, list]) => list));
    let verdict: "OOP_CANDIDATE" | "MANY_EXPORTS" | null = null;
    if (shared.length > 0 && functionsUsingState.size >= 2) verdict = "OOP_CANDIDATE";
    else if (functions.length >= 6) verdict = "MANY_EXPORTS";
    if (verdict == null) continue;
    const detail = `${functions.length} funcs; ${states.size} state; shared ${shared.map(([name, list]) => `${name}×${list.length}`).join(", ") || "none"}`;
    findings.push({
      rule: "oop",
      file: toPosix(entry.file),
      line: lineOf(sourceFile, sourceFile.statements[0] ?? sourceFile),
      symbol: path.basename(entry.file).replace(/\.(ts|tsx)$/, ""),
      verdict,
      detail,
      blocking: ctx.strict === true,
    });
  }
  return findings.sort((a, b) => a.verdict.localeCompare(b.verdict) || locationKey(a).localeCompare(locationKey(b)));
}

/** 旧脚本按 `${file}:${line}` 裸字符串字典序排（不补零），保形。 */
function locationKey(finding: Finding): string {
  return `${finding.file}:${finding.line}`;
}

function parseText(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
