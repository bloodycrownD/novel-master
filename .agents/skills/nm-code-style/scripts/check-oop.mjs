#!/usr/bin/env node
/**
 * nm-code-style §9：OOP 化候选（只读、启发式，最后一步才看）。
 *
 * 只报两类：
 *   OOP_CANDIDATE — 多个导出函数读写同一份模块级可变状态（Map/Set/let）；
 *   MANY_EXPORTS  — 导出函数 >= 8，建议人工看是否应聚成 store/manager；
 *
 * 不自动建类：纯函数模块、DTO、hook、单个函数都不应因为“导出多”就 OOP。
 *
 * 用法：
 *   node .../check-oop.mjs packages/core/src/domain/chat/logic
 *   node .../check-oop.mjs --changed
 *   node .../check-oop.mjs --verbose
 *   node .../check-oop.mjs --strict
 */

import fs from "node:fs";
import ts from "typescript";
import { collectFiles, formatTable, lineOf, parseFlags, parseSource, toPosix } from "./lib/style-utils.mjs";

const flags = parseFlags(process.argv.slice(2));
const files = collectFiles({ ...flags, includeTests: false });
const rows = [];

function isExported(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function functionEntries(sourceFile) {
  const entries = [];
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name != null && statement.body != null) {
      entries.push({ name: statement.name.text, body: statement.body, node: statement });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const init = declaration.initializer;
        if (init != null && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) entries.push({ name: declaration.name.text, body: init.body, node: declaration });
      }
    }
  }
  return entries;
}

function stateNames(sourceFile) {
  const names = new Set();
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

function usedStates(body, names) {
  const used = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node) && names.has(node.text)) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node);
      const isDeclarationName = (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isParameter(parent)) && parent.name === node;
      if (!isPropertyName && !isDeclarationName) used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return used;
}

for (const file of files) {
  const sourceFile = parseSource(file);
  const states = stateNames(sourceFile);
  const functions = functionEntries(sourceFile);
  const usage = new Map();
  for (const fn of functions) {
    for (const state of usedStates(fn.body, states)) {
      const list = usage.get(state) ?? [];
      list.push(fn.name);
      usage.set(state, list);
    }
  }
  const shared = [...usage].filter(([, list]) => list.length >= 2);
  const functionsUsingState = new Set(shared.flatMap(([, list]) => list));
  let verdict = "KEEP";
  if (shared.length > 0 && functionsUsingState.size >= 2) verdict = "OOP_CANDIDATE";
  else if (functions.length >= 6) verdict = "MANY_EXPORTS";
  if (verdict === "KEEP" && !flags.verbose) continue;
  const detail = `${states.size} state; shared ${shared.map(([name, list]) => `${name}×${list.length}`).join(", ") || "none"}`;
  rows.push([verdict, functions.length, states.size, functionsUsingState.size, `${toPosix(file)}:${lineOf(sourceFile, sourceFile.statements[0] ?? sourceFile)}`, detail]);
}

rows.sort((a, b) => a[0].localeCompare(b[0]) || a[4].localeCompare(b[4]));

if (flags.json) {
  console.log(JSON.stringify(rows.map(([verdict, functions, states, shared, location, detail]) => ({ verdict, functions, states, shared, location, detail })), null, 2));
} else {
  console.log(`check-oop: ${rows.filter(([verdict]) => verdict !== "KEEP").length} 个候选（扫描 ${files.length} 个文件）`);
  if (rows.length > 0) console.log(formatTable(["verdict", "funcs", "state", "shared", "location", "detail"], rows));
  console.log("规则：OOP 是最后一步；OOP_CANDIDATE 需对象化或在报告说明为何不；MANY_EXPORTS 只表示人工 review，纯函数模块不建类。");
}

process.exitCode = rows.some(([verdict]) => verdict !== "KEEP") ? 1 : 0;
