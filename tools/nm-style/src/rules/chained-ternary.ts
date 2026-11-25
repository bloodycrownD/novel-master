/**
 * chained-ternary 规则：嵌套 / 链式的三元表达式 = 0。
 *
 * 判据是结构而不是文本：一个 ConditionalExpression 的真分支或假分支（允许外套括号）本身
 * 又是一个 ConditionalExpression，即报在最外层那一个上。`a ? x : b ? y : z`（链式，假分支
 * 接续）与 `a ? (b ? y : z) : w`（真分支里再套一个）都命中。不命中的两种：条件位置里嵌的
 * 三元（`(a ? b : c) ? x : y`，它不是接续的分支链）；同一条语句里彼此独立的两个三元
 * （`f(a ? x : y, b ? p : q)`，包括条件里回调函数自带的那个）。一条语句里有多个互不包含的
 * 链时各报一条（按最外层节点计）。
 *
 * 行内豁免：所在语句带 `nm-style: keep-ternary` 前导注释（对齐 keep-* 惯例），
 * 豁免须在注释里写明理由。blocking 恒 true：改成 if / else 或 switch 没有例外形态，
 * 确有理由的留在代码现场自文档化。
 */

import ts from "typescript";
import { lineOf, parseSource, toPosix } from "../lib/core.js";
import type { Finding } from "../lib/report.js";
import type { ScanEntry } from "./signatures.js";

export interface ChainedTernaryContext {
    entries: readonly ScanEntry[];
}

const EXEMPT_MARK = "nm-style: keep-ternary";

/** 节点所在语句的前导注释里是否带豁免标记（`// nm-style: keep-ternary — 理由`）。 */
function isExempt(sourceFile: ts.SourceFile, node: ts.Node): boolean {
    let statement: ts.Node = node;
    while (!ts.isStatement(statement) && statement.parent != null) statement = statement.parent;
    const ranges = ts.getLeadingCommentRanges(sourceFile.text, statement.getFullStart()) ?? [];
    return ranges.some((range) => sourceFile.text.slice(range.pos, range.end).includes(EXEMPT_MARK));
}

/** 剥掉括号与类型断言外壳，看分支本体是不是又一个三元。 */
function unwrap(node: ts.Expression): ts.Expression {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
    return current;
}

/** 真分支或假分支本身又是三元 → 这一个三元是接续链的外层。 */
function isChainHead(node: ts.ConditionalExpression): boolean {
    return ts.isConditionalExpression(unwrap(node.whenTrue)) || ts.isConditionalExpression(unwrap(node.whenFalse));
}

/** 收集链的最外层三元节点；命中后不再往其内部下探（一条链只报一次）。 */
function collectChained(root: ts.Node, out: ts.ConditionalExpression[]): void {
    ts.forEachChild(root, (child) => {
        if (ts.isConditionalExpression(child) && isChainHead(child)) {
            out.push(child);
            return;
        }
        collectChained(child, out);
    });
}

export function scanChainedTernary(ctx: ChainedTernaryContext): Finding[] {
    const findings: Finding[] = [];
    for (const entry of ctx.entries) {
        const sourceFile = entry.text == null ? parseSource(entry.file) : parseText(entry.file, entry.text);
        const chained: ts.ConditionalExpression[] = [];
        collectChained(sourceFile, chained);
        for (const node of chained) {
            if (isExempt(sourceFile, node)) continue;
            findings.push({
                rule: "chained-ternary",
                file: toPosix(entry.file),
                line: lineOf(sourceFile, node),
                symbol: entry.file.replace(/.*[/\\]/, "").replace(/\.(ts|tsx)$/, ""),
                verdict: "CHAINED_TERNARY",
                detail: sourceFile.text.split(/\r?\n/)[lineOf(sourceFile, node) - 1].trim().slice(0, 120),
                blocking: true,
            });
        }
    }
    return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function parseText(file: string, text: string): ts.SourceFile {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
