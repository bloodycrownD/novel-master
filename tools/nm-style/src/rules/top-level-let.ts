/**
 * top-level-let 规则：模块顶层裸 let = 0——p27 R3 的回归门。
 *
 * 「模块顶层」= SourceFile 直接 statements 与 namespace/module 声明体的直接
 * statements（沿 ModuleBlock 链下探，任意嵌套深度）；函数体/方法体/控制流内的
 * let 不在门内（纯局部可变不属 R3 判据）。R3 判据：离散可变变量不该裸露，
 * 应由对象管理（对象槽 / holder / BusyFlag）。
 *
 * 行内豁免：语句带 `nm-style: keep-top-let` 前导注释（对齐 keep-* 惯例），
 * 豁免须在注释里写明理由。blocking 恒 true（spec §3.3：顶层 let = 0 是硬门，
 * 不吃 KFP——残余正当豁免走代码现场的 keep-top-let，自文档化）。
 */

import ts from "typescript";
import { lineOf, parseSource, toPosix } from "../lib/core.js";
import type { Finding } from "../lib/report.js";
import type { ScanEntry } from "./signatures.js";

export interface TopLevelLetContext {
    entries: readonly ScanEntry[];
}

const EXEMPT_MARK = "nm-style: keep-top-let";

/** 语句的前导注释里是否带豁免标记（`// nm-style: keep-top-let — 理由`）。 */
function isExempt(sourceFile: ts.SourceFile, statement: ts.Statement): boolean {
    const ranges = ts.getLeadingCommentRanges(sourceFile.text, statement.getFullStart()) ?? [];
    return ranges.some((range) => sourceFile.text.slice(range.pos, range.end).includes(EXEMPT_MARK));
}

function isModuleTopLevel(statement: ts.Statement): statement is ts.VariableStatement {
    // 递归由调用方完成；此处只判 let 语句本身（VariableStatement 无父歧义）。
    return ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Let) !== 0;
}

/** 源文件与 namespace/module 块的直接 statements 下探收集顶层 let 声明。 */
function collectTopLevelLets(stmts: readonly ts.Statement[], sourceFile: ts.SourceFile, out: Array<{ node: ts.VariableStatement; names: string[] }>): void {
    for (const statement of stmts) {
        if (isModuleTopLevel(statement) && !isExempt(sourceFile, statement)) {
            const names = statement.declarationList.declarations.filter((d) => ts.isIdentifier(d.name)).map((d) => (d.name as ts.Identifier).text);
            out.push({ node: statement, names });
        }
        if (ts.isModuleDeclaration(statement) && statement.body != null && ts.isModuleBlock(statement.body)) {
            collectTopLevelLets(statement.body.statements, sourceFile, out);
        }
    }
}

export function scanTopLevelLet(ctx: TopLevelLetContext): Finding[] {
    const findings: Finding[] = [];
    for (const entry of ctx.entries) {
        const sourceFile = entry.text == null ? parseSource(entry.file) : parseText(entry.file, entry.text);
        const lets: Array<{ node: ts.VariableStatement; names: string[] }> = [];
        collectTopLevelLets(sourceFile.statements, sourceFile, lets);
        if (lets.length === 0) continue;
        const detail = lets.map((l) => l.names.join(", ")).join(" / ");
        findings.push({
            rule: "top-level-let",
            file: toPosix(entry.file),
            line: lineOf(sourceFile, lets[0].node),
            symbol: entry.file.replace(/.*[/\\]/, "").replace(/\.(ts|tsx)$/, ""),
            verdict: "TOP_LEVEL_LET",
            detail,
            blocking: true,
        });
    }
    return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function parseText(file: string, text: string): ts.SourceFile {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
