#!/usr/bin/env node
/**
 * 扫描「Hermes 对象 spread + await」风险写法。
 *
 * 背景：facebook/hermes#2068（closed，**不 backport 到 stable**）——对象字面量里有
 * ≥2 个 spread、且其中一个 spread 的表达式含 `await` 时，Hermes 会把
 * `copyDataProperties` 的合并发射在 await 依赖的属性写入**之前**（属性写入落在
 * resume continuation），于是该 spread 静默丢字段，V8/JSC 正常。RN 0.85.3 的
 * hermesc 250829098.0.10 与 RN 0.86.0 的 .0.14 均复现（v1.5.49 的 search 装配
 * 正是踩这条：toolCtx 有 ...skills / ...agents / ...search 三个条件 spread）。
 * 官方 workaround：**先把对象构造好再 spread**（await 结果先落局部变量）。
 *
 * 判据：
 * - 对象字面量：SpreadAssignment ≥ 2 且其中一个 spread 的表达式子树含 AwaitExpression → **命中**（退出码 1）
 * - 数组字面量：spread 元素含 await（facebook/hermes#2010 形态）→ 仅列出。该路径已由
 *   upstream 提交 `ebea6ab` 修复，真机 Hermes v0.16.0 实测正常
 *   （`[...await]` → [1,2]、`[0,...await,9]` → [0,1,2,9]），仅作提示。
 *
 * 用法：
 *   node scripts/scan-spread-await-risk.mjs            # 扫描 packages/ 与 apps/
 *   node scripts/scan-spread-await-risk.mjs --selftest # 先验证扫描器本身能命中已知坏写法
 *
 * 退出码：对象形态 0 处 → 0；有命中 → 1（可作 CI / CR 门）。
 */

import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, extname} from 'node:path';
import ts from 'typescript';

const ROOTS = ['packages', 'apps'];
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'tmp', 'release', 'coverage', '.cxx']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (['.ts', '.tsx'].includes(extname(name))) yield path;
  }
}

/** 表达式子树里是否含 await。 */
function hasAwait(node) {
  let found = false;
  const visit = (current) => {
    if (ts.isAwaitExpression(current)) found = true;
    if (!found) ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/** 解析源码文本，返回 {objects, arrays} 两类命中。 */
function scanSource(text, file) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, kind);
  const objects = [];
  const arrays = [];
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const spreads = node.properties.filter((property) => ts.isSpreadAssignment(property));
      const awaitSpreads = spreads.filter((spread) => hasAwait(spread.expression));
      if (spreads.length >= 2 && awaitSpreads.length > 0) {
        const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        objects.push({file, line: line + 1, spreads: spreads.length, snippet: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120)});
      }
    }
    if (ts.isArrayLiteralExpression(node)) {
      const spreads = node.elements.filter((element) => ts.isSpreadElement(element));
      const awaitSpreads = spreads.filter((spread) => hasAwait(spread.expression));
      if (awaitSpreads.length > 0) {
        const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        arrays.push({file, line: line + 1, elements: node.elements.length, snippet: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120)});
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {objects, arrays};
}

if (process.argv.includes('--selftest')) {
  // 已知坏写法（v1.5.49 的装配形态）：扫描器必须命中，否则判据失效。
  const {objects: selfHits} = scanSource('async function f(base, cond) { const g = async () => ({x: 1}); return {...base, ...(cond ? {s: await g()} : {})}; }', 'selftest.ts');
  if (selfHits.length !== 1) {
    console.error(`[selftest] FAIL：期望命中 1 处，实际 ${selfHits.length} 处 —— 扫描判据已失效`);
    process.exit(2);
  }
  console.log('[selftest] OK：能命中「≥2 spread 且含 await」的已知坏写法');
}

const objects = [];
const arrays = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('...') || !text.includes('await')) continue;
    const result = scanSource(text, file);
    objects.push(...result.objects);
    arrays.push(...result.arrays);
  }
}

console.log(`对象字面量（≥2 spread 且其中一个含 await）命中：${objects.length} 处`);
for (const hit of objects) console.log(`  ${hit.file}:${hit.line}  spreads=${hit.spreads}\n    ${hit.snippet}`);
console.log(`数组字面量（spread 含 await，#2010 形态，已修，仅提示）：${arrays.length} 处`);
for (const hit of arrays) console.log(`  ${hit.file}:${hit.line}  elements=${hit.elements}\n    ${hit.snippet}`);

process.exit(objects.length > 0 ? 1 : 0);
