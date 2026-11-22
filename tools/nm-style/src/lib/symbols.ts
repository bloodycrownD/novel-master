/**
 * symbol-index：形态无关符号表 + 限定引用计数（spec §3.2，本重写的核心模块）。
 * 一张表覆盖全部声明形态（bare-fn / var-fn / 对象成员 / object-binding / class 成员 /
 * namespace-object），dead / inline / exports 审计消费同一张表：顶层符号（container=null）
 * 按裸名标识符计数；成员符号按 Container.member 属性访问链计数，接收者无法静态归因时
 * 按属性名命中全部同名成员（保守归因，宁漏报不误杀；identifier/属性尾段只认真绑定容器，
 * 回退命名容器——实参/数组元素/工厂返回——不充当归因目标）；private class 方法只数同文件同类。
 * 遍历一律 forEachChild 语义——JSDoc/注释不是 child，旧 getChildren 全遍历把 `{@link}`
 * 当引用是已证假阳性源，这里从机制上排除。
 * 导出面机制沿旧 find-fake-exports 全套并形态无关化：import 感知（named / as 别名 /
 * namespace import）+ prod/test 分桶（isProductionPath）+ 同名多定义 AMBIGUOUS
 * （topLevelNameCount）+ public snapshot allowlist（opts.snapshotDir 注入）。
 * v1 边界（显式不做）：不上 ts.createProgram 语义解析，同名遮蔽与动态属性靠保守归因兜底。
 */

import fs from "node:fs";
import { ok as assertInvariant } from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { isTestPath } from "./core.js";

// ---------- 公开类型 ----------

export type SymbolForm = "bare-fn" | "var-fn" | "object-method" | "object-arrow" | "object-binding" | "class-method" | "class-accessor" | "namespace-object";

export interface SymbolContainer {
    kind: "namespace" | "object" | "class";
    name: string;
}

export interface SymbolInfo {
    name: string;
    container: SymbolContainer | null;
    form: SymbolForm;
    /** 被扫仓相对 posix 路径（与传入 unit.file 一致）。 */
    file: string;
    line: number;
    exported: boolean;
    isPrivate: boolean;
    deprecated: boolean;
}

/** object-binding 的挂载关系：成员符号 ↔ 被绑定函数（hygiene 用它连接「函数本体零引用」与「经容器成员存活」。 */
export interface SymbolBinding {
    member: SymbolInfo;
    /** 被绑定函数名（import 别名解析后）。 */
    boundName: string;
    /** 被绑定函数可解析为仓内顶层符号时给出。 */
    bound?: SymbolInfo;
}

export interface LocalRefs {
    calls: number;
    refs: number;
    /** 定义体内出现的自引用（不计入 calls/refs；成员符号恒 0）。 */
    selfRefs: number;
}

export interface GlobalRefs {
    prodCalls: number;
    prodRefs: number;
    testCalls: number;
    testRefs: number;
}

export interface SymbolUnit {
    /** 被扫仓相对 posix 路径。 */
    file: string;
    text: string;
}

export interface SymbolIndexOptions {
    /** public snapshot allowlist 目录（*.json，内容为名称数组）；缺省不加载。CLI 层传 `<repoRoot>/packages/core/test/package-exports/snapshots`。 */
    snapshotDir?: string;
}

export interface SymbolIndex {
    readonly symbols: readonly SymbolInfo[];
    readonly bindings: readonly SymbolBinding[];
    /** public snapshot allowlist 名称集合（目录缺省/不存在时为空集）。 */
    readonly publicNames: ReadonlySet<string>;
    /** 仓内同名「导出顶层符号」个数；>1 时 hygiene 按 AMBIGUOUS 短路一切 verdict。 */
    topLevelNameCount(name: string): number;
    /** 私有面计数：顶层/嵌套函数=同文件裸名（自引用另计）；private class 方法=同文件同类属性访问；namespace 成员加同文件裸名；其余成员=同文件精确归因链。 */
    localRefs(symbol: SymbolInfo): LocalRefs;
    /** 导出面/成员面计数：顶层符号=import 感知全仓裸名；成员=Container.member 链（接收者无法归因时按属性名保守命中全部同名成员）；prod/test 分桶。 */
    globalRefs(symbol: SymbolInfo): GlobalRefs;
    /** 按名字查符号：containerName 缺省=全部；null=只查顶层；字符串=按容器名过滤。 */
    find(name: string, containerName?: string | null): SymbolInfo[];
}

/** 生产路径判定（沿旧 find-fake-exports 口径）：非 test、非 core public、且位于 packages|apps 的 src 下。 */
export function isProductionPath(rel: string): boolean {
    if (isTestPath(rel)) return false;
    if (rel.startsWith("packages/core/src/public/")) return false;
    return /^packages\/[^/]+\/src\//.test(rel) || /^apps\/[^/]+\/src\//.test(rel) || /^apps\/desktop\/(renderer|shared|src)\//.test(rel);
}

// ---------- 内部结构 ----------

type ContainerKind = "namespace" | "object" | "class";

interface RawOccurrence {
    node: ts.Identifier;
    /** 别名解析前的原文（定义文件按原文匹配）。 */
    raw: string;
    /** import 别名解析后的名字（消费文件按解析名匹配）。 */
    name: string;
    isCall: boolean;
}

interface RawMemberSite {
    node: ts.PropertyAccessExpression;
    member: string;
    isCall: boolean;
    /** 引用点所在的类名（private 同类限定用）。 */
    enclosingClassName: string | null;
    /** 纯赋值写入位（`C.m = x`）不算成员消费。 */
    isAssignmentTarget: boolean;
}

interface BindingCandidate {
    /** 绑定值标识符（validBindingNodes 的键）。 */
    valueNode: ts.Identifier;
    container: ContainerDef;
    propName: string;
    declNode: ts.Node;
    boundRaw: string;
}

interface ContainerDef {
    name: string;
    kind: ContainerKind;
    unit: UnitData;
    exported: boolean;
    /** true=回退命名：名字是猜的（ownerName/文件名），对象并未直接绑定到该名字（实参/数组元素/工厂返回）；false=真绑定（const X = {...} / 属性位 / namespace / class）。 */
    fallback: boolean;
    members: InternalDef[];
}

interface InternalDef {
    info: SymbolInfo;
    unit: UnitData;
    /** 声明节点（行号/deprecated 已在 info 里，留作调试锚点）。 */
    decl?: ts.Node;
    /** 函数体节点（自引用判定作用域；var-fn 为 initializer）。 */
    body?: ts.Node;
    container?: ContainerDef;
}

interface UnitData {
    file: string;
    sourceFile: ts.SourceFile;
    isProd: boolean;
    isTest: boolean;
    /** named import：本地名 → 导入名。 */
    aliases: Map<string, string>;
    /** namespace import 本地名（`import * as ns`）。 */
    namespaceLocals: Set<string>;
    /** 本文件 named import 进来的名字（跨文件裸名计数的作用域门）。 */
    importedNames: Set<string>;
    /** 本文件定义的容器（接收者归因时本文件优先）。 */
    localContainers: Map<string, ContainerDef[]>;
    occurrences: RawOccurrence[];
    memberSites: RawMemberSite[];
    bindingCandidates: BindingCandidate[];
    /** 绑定解析通过后的值节点：这些位置不计裸名消费。 */
    validBindingNodes: Set<ts.Identifier>;
    /** `export { x }` / `export default x` 需要补标导出面的本文件符号名。 */
    exportNamesToMark: Set<string>;
    lineOf(node: ts.Node): number;
}

interface CollectCtx {
    container: ContainerDef | null;
    ownerName: string | null;
}

/** collectUnit 的 per-unit 遍历上下文：visitUnitNode 及其调用的注册/登记函数共享的原闭包捕获集。 */
interface UnitWalkCtx {
    data: UnitData;
    defs: InternalDef[];
    sourceFile: ts.SourceFile;
}

/** buildSymbolIndex 的 index 级共享状态：globalRefsOf/localRefsOf 提升为模块级后的原闭包捕获集。 */
interface IndexCtx {
    defBySymbol: Map<SymbolInfo, InternalDef>;
    exportedTopLevelCount: Map<string, number>;
    unitData: UnitData[];
    containersByName: Map<string, ContainerDef[]>;
}

// ---------- 解析辅助 ----------

function hasExportModifier(node: ts.Node): boolean {
    return (ts.getCombinedModifierFlags(node as unknown as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function isPrivateMember(node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration): boolean {
    return ts.isPrivateIdentifier(node.name) || (ts.getCombinedModifierFlags(node as unknown as ts.Declaration) & ts.ModifierFlags.Private) !== 0;
}

/** 成员名文本：Identifier / StringLiteral / PrivateIdentifier；计算名（[expr]）不收。 */
function memberNameText(name: ts.Node): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
    return null;
}

function isMemberDecl(node: ts.Node): node is ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration {
    return ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function exportFlagOfVariableDeclaration(node: ts.VariableDeclaration): boolean {
    const statement = node.parent.parent;
    return statement != null && ts.isVariableStatement(statement) && hasExportModifier(statement);
}

/** 值位置解包：剥掉 `(...)` / `as` / `satisfies` / `!` 包裹，找到真实绑定父节点。 */
function unwrapValue(node: ts.Node): ts.Node {
    let current = node;
    for (;;) {
        const parent = current.parent;
        if (parent != null && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent))) {
            current = parent;
            continue;
        }
        return current;
    }
}

function isInside(node: ts.Node, ancestor: ts.Node): boolean {
    for (let current: ts.Node | undefined = node; current != null; current = current.parent) {
        if (current === ancestor) return true;
    }
    return false;
}

/**
 * @deprecated 判定（旧 check-methods 口径的收窄版）：节点或注释锚点链上的 JSDoc tag，
 * 外加锚点领先 trivia 里的 @deprecated 字样（旧版是裸 500 字符 regex，会跨符号误染，
 * 这里收窄为 leading trivia，只覆盖节点自身的前置注释）。
 */
function isDeprecatedNode(node: ts.Node): boolean {
    for (let current: ts.Node | undefined = node; current != null; current = current.parent) {
        if (ts.getJSDocTags(current).some((tag) => tag.tagName.text === "deprecated")) return true;
        const sourceFile = current.getSourceFile();
        if (/@deprecated\b/.test(sourceFile.text.slice(current.getFullStart(), current.getStart(sourceFile)))) return true;
        if (ts.isStatement(current) || ts.isPropertyAssignment(current) || ts.isPropertyDeclaration(current) || isMemberDecl(current)) return false;
    }
    return false;
}

/** 裸名计数的剔除位：定义名、属性名、import/export 名、类型位、解构位、标签位。JSDoc 不在 forEachChild 里，天然排除。 */
function isExcludedRefPosition(node: ts.Identifier, parent: ts.Node): boolean {
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isExportAssignment(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isMetaProperty(parent)) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
    if (ts.isQualifiedName(parent) && parent.right === node) return true;
    if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return true;
    if (ts.isBindingElement(parent)) return true;
    if (ts.isMethodSignature(parent) || ts.isPropertySignature(parent) || ts.isTypeParameterDeclaration(parent)) return true;
    if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) return true;
    if (ts.isLabeledStatement(parent) && parent.label === node) return true;
    return isDeclarationNamePosition(node, parent);
}

function isDeclarationNamePosition(node: ts.Identifier, parent: ts.Node): boolean {
    const named = parent as ts.Declaration & { name?: ts.Node };
    if (named.name !== node) return false;
    return ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isFunctionExpression(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isModuleDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isEnumMember(parent) || ts.isNamespaceImport(parent) || ts.isCatchClause(parent);
}

function enclosingClassNameOf(node: ts.Node): string | null {
    for (let current: ts.Node | undefined = node.parent; current != null; current = current.parent) {
        if ((ts.isClassDeclaration(current) || ts.isClassExpression(current)) && current.name != null) return current.name.text;
    }
    return null;
}

function loadPublicNames(dir: string | undefined): ReadonlySet<string> {
    const names = new Set<string>();
    if (dir == null || !fs.existsSync(dir)) return names;
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        try {
            const value = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as unknown;
            if (Array.isArray(value)) for (const name of value) if (typeof name === "string") names.add(name);
        } catch (error) {
            console.error(`nm-style: public snapshot ${file} 解析失败，已跳过 —— ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return names;
}

// ---------- 收集 ----------

function collectUnit(unit: SymbolUnit, defs: InternalDef[]): UnitData {
    const scriptKind = unit.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(unit.file, unit.text, ts.ScriptTarget.Latest, true, scriptKind);
    const data: UnitData = {
        file: unit.file,
        sourceFile,
        isProd: isProductionPath(unit.file),
        isTest: isTestPath(unit.file),
        aliases: new Map(),
        namespaceLocals: new Set(),
        importedNames: new Set(),
        localContainers: new Map(),
        occurrences: [],
        memberSites: [],
        bindingCandidates: [],
        validBindingNodes: new Set(),
        exportNamesToMark: new Set(),
        lineOf: (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    };

    // import 作用域预扫 + 导出面补标收集（`export { x }` / `export default x`）。
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const bindings = statement.importClause?.namedBindings;
            if (bindings != null && ts.isNamespaceImport(bindings)) data.namespaceLocals.add(bindings.name.text);
            if (bindings != null && ts.isNamedImports(bindings)) {
                for (const element of bindings.elements) {
                    const imported = (element.propertyName ?? element.name).text;
                    data.importedNames.add(imported);
                    if (element.name.text !== imported) data.aliases.set(element.name.text, imported);
                }
            }
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier == null && statement.exportClause != null && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) data.exportNamesToMark.add((element.propertyName ?? element.name).text);
        } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
            data.exportNamesToMark.add(statement.expression.text);
        }
    }

    const unitCtx: UnitWalkCtx = { data, defs, sourceFile };
    for (const statement of sourceFile.statements) visitUnitNode(statement, unitCtx, { container: null, ownerName: null });
    return data;
}

function registerContainer(data: UnitData, kind: ContainerKind, name: string, exported: boolean, fallback: boolean): ContainerDef {
    const container: ContainerDef = { name, kind, unit: data, exported, fallback, members: [] };
    const list = data.localContainers.get(name) ?? [];
    list.push(container);
    data.localContainers.set(name, list);
    return container;
}

function addTopDef(data: UnitData, defs: InternalDef[], name: string, form: SymbolForm, node: ts.Node, exported: boolean, body?: ts.Node, container?: ContainerDef): void {
    const info: SymbolInfo = { name, container: container == null ? null : { kind: container.kind, name: container.name }, form, file: data.file, line: data.lineOf(node), exported, isPrivate: false, deprecated: isDeprecatedNode(node) };
    defs.push({ info, unit: data, decl: node, body, container });
}

function addMemberDef(data: UnitData, defs: InternalDef[], container: ContainerDef, name: string, form: SymbolForm, node: ts.Node, isPrivate: boolean): void {
    // namespace 成员看自己的 export 修饰符；object/class 成员随容器导出面（private 永不在面上）。
    const exported = container.kind === "namespace" ? hasExportModifier(node) : container.exported && !isPrivate;
    const info: SymbolInfo = { name, container: { kind: container.kind, name: container.name }, form, file: data.file, line: data.lineOf(node), exported, isPrivate, deprecated: isDeprecatedNode(node) };
    const def: InternalDef = { info, unit: data, decl: node, container };
    defs.push(def);
    container.members.push(def);
}

/** 对象字面量的绑定名：具名变量 / 属性位 / 其余回退到外层具名函数名或文件名（工厂返回、port 实参同口径）。 */
function objectBindingOf(node: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): { name: string; exported: boolean; topLevel: boolean; declNode: ts.Node } | null {
    const outer = unwrapValue(node);
    const parent = outer.parent;
    if (parent != null && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        const statement = parent.parent.parent;
        const isVariableStatement = statement != null && ts.isVariableStatement(statement);
        return { name: parent.name.text, exported: isVariableStatement && hasExportModifier(statement), topLevel: isVariableStatement && statement.parent === sourceFile, declNode: parent };
    }
    if (parent != null && (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && memberNameText(parent.name) != null) {
        return { name: memberNameText(parent.name) as string, exported: false, topLevel: false, declNode: parent };
    }
    return null;
}

function classBindingOf(node: ts.ClassDeclaration | ts.ClassExpression): { name: string; exported: boolean } | null {
    if (ts.isClassDeclaration(node)) return node.name == null ? null : { name: node.name.text, exported: hasExportModifier(node) };
    const outer = unwrapValue(node);
    const parent = outer.parent;
    if (parent != null && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return { name: parent.name.text, exported: exportFlagOfVariableDeclaration(parent) };
    if (parent != null && ts.isPropertyDeclaration(parent) && memberNameText(parent.name) != null) return { name: memberNameText(parent.name) as string, exported: false };
    return null;
}

function visitUnitNode(node: ts.Node, unitCtx: UnitWalkCtx, ctx: CollectCtx): void {
    const { data, defs, sourceFile } = unitCtx;
    // —— 容器与声明形态 ——
    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.body != null) {
        const exported = hasExportModifier(node);
        const container = registerContainer(data, "namespace", node.name.text, exported, false);
        if (node.parent === sourceFile && exported) addTopDef(data, defs, node.name.text, "namespace-object", node, exported);
        ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, { container, ownerName: node.name.text }));
        return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const bound = classBindingOf(node);
        if (bound == null) {
            ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, { container: null, ownerName: ctx.ownerName }));
            return;
        }
        const container = registerContainer(data, "class", bound.name, bound.exported, false);
        // 只有成员声明拿到 class 上下文；构造器/属性初始化器里的嵌套函数不属于类成员。
        ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, { container: isMemberDecl(child) ? container : null, ownerName: bound.name }));
        return;
    }
    if (ts.isObjectLiteralExpression(node)) {
        const bound = objectBindingOf(node, sourceFile);
        const name = bound?.name ?? ctx.ownerName ?? path.basename(data.file).replace(/\.(ts|tsx)$/, "");
        // bound == null → 回退命名容器：名字来自 ownerName/文件名猜测（实参/数组元素/工厂返回），对象并未绑定到该名字，接收者归因不得把它当该名字的真值（spec §3.2）。
        const container = registerContainer(data, "object", name, bound?.exported ?? false, bound == null);
        // 顶层导出的对象字面量本身入表（namespace-object），供 exports 审计判整对象死活。
        if (bound != null && bound.topLevel && bound.exported) addTopDef(data, defs, bound.name, "namespace-object", bound.declNode, true);
        ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, { container: isMemberDecl(child) || ts.isPropertyAssignment(child) || ts.isShorthandPropertyAssignment(child) ? container : null, ownerName: name }));
        return;
    }
    if (ts.isFunctionDeclaration(node) && node.name != null) {
        const fnName = node.name.text;
        addTopDef(data, defs, fnName, "bare-fn", node, hasExportModifier(node), node.body ?? undefined, ctx.container ?? undefined);
        ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, { container: null, ownerName: fnName }));
        return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer != null) {
        const varName = node.name.text;
        const init = node.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            addTopDef(data, defs, varName, "var-fn", node, exportFlagOfVariableDeclaration(node), init, ctx.container ?? undefined);
            ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, { container: null, ownerName: varName }));
            return;
        }
        ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, { container: ctx.container, ownerName: varName }));
        return;
    }
    if (ts.isPropertyAssignment(node) && ctx.container?.kind === "object") {
        const propName = memberNameText(node.name);
        if (propName != null) {
            if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) addMemberDef(data, defs, ctx.container, propName, "object-arrow", node, false);
            else if (ts.isIdentifier(node.initializer)) {
                // object-binding 候选：{ check: fn } —— 绑定有效性后置解析，有效才注册成员并豁免绑定位裸名。
                data.bindingCandidates.push({ valueNode: node.initializer, container: ctx.container, propName, declNode: node, boundRaw: node.initializer.text });
            }
        }
        ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, ctx));
        return;
    }
    if (ts.isShorthandPropertyAssignment(node) && ctx.container?.kind === "object") {
        // { helper } 简写：名字即值，同走绑定候选。
        data.bindingCandidates.push({ valueNode: node.name, container: ctx.container, propName: node.name.text, declNode: node, boundRaw: node.name.text });
        ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, ctx));
        return;
    }
    if (isMemberDecl(node) && ctx.container != null) {
        const name = memberNameText(node.name);
        if (name != null) {
            if (ctx.container.kind === "class") addMemberDef(data, defs, ctx.container, name, ts.isMethodDeclaration(node) ? "class-method" : "class-accessor", node, isPrivateMember(node));
            else if (ts.isMethodDeclaration(node)) addMemberDef(data, defs, ctx.container, name, "object-method", node, false); // 对象字面量的 get/set 不在八值 form 内，不收
        }
        ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, { container: null, ownerName: name ?? ctx.ownerName }));
        return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.name) && ts.isIdentifier(node.left.expression)) {
        // Ns.check = fn 成员赋值注册（容器限本文件定义）；右值为箭头/函数表达式则收 object-arrow。
        const container = data.localContainers.get(node.left.expression.text)?.[0];
        if (container != null) {
            if (ts.isIdentifier(node.right)) {
                data.bindingCandidates.push({ valueNode: node.right, container, propName: node.left.name.text, declNode: node, boundRaw: node.right.text });
            } else if (ts.isArrowFunction(node.right) || ts.isFunctionExpression(node.right)) {
                addMemberDef(data, defs, container, node.left.name.text, "object-arrow", node, false);
            }
        }
        ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, ctx));
        return;
    }

    // —— 泛型引用登记 ——
    if (ts.isIdentifier(node)) {
        if (!isExcludedRefPosition(node, node.parent)) {
            const raw = node.text;
            data.occurrences.push({ node, raw, name: data.aliases.get(raw) ?? raw, isCall: (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) && node.parent.expression === node });
        }
        return;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
        data.memberSites.push({
            node,
            member: node.name.text,
            isCall: (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) && node.parent.expression === node,
            enclosingClassName: enclosingClassNameOf(node),
            isAssignmentTarget: ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.parent.left === node,
        });
    }
    ts.forEachChild(node, (child) => visitUnitNode(child, unitCtx, ctx));
}

// ---------- 索引构建 ----------

export function buildSymbolIndex(units: readonly SymbolUnit[], options: SymbolIndexOptions = {}): SymbolIndex {
    const defs: InternalDef[] = [];
    const unitData = units.map((unit) => collectUnit(unit, defs));

    // 全局容器名表（接收者归因用）与顶层符号名表（uniqueNames/AMBIGUOUS 用）。
    const containersByName = new Map<string, ContainerDef[]>();
    for (const u of unitData) {
        for (const list of u.localContainers.values()) {
            for (const container of list) {
                const bucket = containersByName.get(container.name) ?? [];
                bucket.push(container);
                containersByName.set(container.name, bucket);
            }
        }
    }
    const topLevelByName = new Map<string, InternalDef[]>();
    for (const def of defs) {
        if (def.info.container != null) continue;
        const list = topLevelByName.get(def.info.name) ?? [];
        list.push(def);
        topLevelByName.set(def.info.name, list);
    }

    // `export { x }` / `export default x` 补标导出面（本文件定义的顶层符号）。
    for (const u of unitData) {
        for (const name of u.exportNamesToMark) {
            for (const def of topLevelByName.get(name) ?? []) {
                if (def.unit === u) def.info.exported = true;
            }
        }
    }

    const exportedTopLevelCount = new Map<string, number>();
    for (const def of defs) {
        if (def.info.container != null || !def.info.exported) continue;
        exportedTopLevelCount.set(def.info.name, (exportedTopLevelCount.get(def.info.name) ?? 0) + 1);
    }

    // object-binding 绑定解析：被绑定名可落到本文件顶层符号或 named import 才算注册成功。
    const bindings: SymbolBinding[] = [];
    for (const u of unitData) {
        for (const candidate of u.bindingCandidates) {
            const boundName = u.aliases.get(candidate.boundRaw) ?? candidate.boundRaw;
            const locals = (topLevelByName.get(boundName) ?? []).filter((def) => def.unit === u);
            const isImported = locals.length === 0 && u.importedNames.has(boundName) && (topLevelByName.get(boundName)?.length ?? 0) > 0;
            if (locals.length === 0 && !isImported) continue;
            u.validBindingNodes.add(candidate.valueNode);
            const info: SymbolInfo = { name: candidate.propName, container: { kind: candidate.container.kind, name: candidate.container.name }, form: "object-binding", file: u.file, line: u.lineOf(candidate.declNode), exported: candidate.container.exported, isPrivate: false, deprecated: isDeprecatedNode(candidate.declNode) };
            const def: InternalDef = { info, unit: u, decl: candidate.declNode, container: candidate.container };
            defs.push(def);
            candidate.container.members.push(def);
            bindings.push({ member: info, boundName, bound: (locals[0] ?? topLevelByName.get(boundName)?.[0])?.info });
        }
    }

    const defBySymbol = new Map<SymbolInfo, InternalDef>();
    for (const def of defs) defBySymbol.set(def.info, def);

    const index: IndexCtx = { defBySymbol, exportedTopLevelCount, unitData, containersByName };

    const symbols = defs.map((def) => def.info);
    return {
        symbols,
        bindings,
        publicNames: loadPublicNames(options.snapshotDir),
        topLevelNameCount: (name) => exportedTopLevelCount.get(name) ?? 0,
        localRefs: (symbol) => localRefsOf(index, symbol),
        globalRefs: (symbol) => globalRefsOf(index, symbol),
        find: (name, containerName) =>
            defs
                .filter((def) => def.info.name === name && (containerName === undefined || (containerName === null ? def.info.container == null : def.info.container?.name === containerName)))
                .map((def) => def.info),
    };
}

/**
 * 全局唯一容器查找（跨文件兜底，调用方先过 import 门）。三道过滤：
 * ① 回退命名容器（fallback=true）不是绑定值的容器（名字是猜的），identifier / 属性尾段不收；
 * ② 非 test 单元的引用点结构上消费不到 test 文件定义的容器（prod 不 import test）——测试桩是
 *    真绑定容器且名字常与 prod 变量/属性同形，不过滤会把 prod 消费精确劫持到测试桩上；
 * ③ 过滤后非唯一 → null（同名多容器无法区分，走保守归因）。
 */
function globalUniqueContainers(containersByName: Map<string, ContainerDef[]>, name: string, allowFallback: boolean, fromTest: boolean): ContainerDef[] | null {
    const all = (containersByName.get(name) ?? []).filter((c) => (allowFallback || !c.fallback) && (fromTest || !c.unit.isTest));
    if (all.length === 0) return null;
    return all.length === 1 ? all : null; // 全局同名多容器无法区分 → 视为无法归因，走保守兜底
}

/**
 * 接收者归因：返回候选容器列表；null=无法归因（按属性名保守命中全部同名成员）。
 * 归因顺序：本文件同名容器 → import 感知的全局唯一容器 → 属性链尾段 → 工厂调用 callee。
 * identifier / 属性尾段只认真绑定容器（fallback=false）：回退命名容器（实参/数组元素/工厂返回，
 * 名字是猜的）不是该标识符绑定值或该属性的值，放行会把真消费劫持到实参对象上（如
 * `const w = Factory.create({...}); w.noteActivity()` 的实参被注册成名为 w 的容器 → 假 DEAD）。
 * 跨文件查找必须过 import 门（v1 不上语义解析，用已登记的 import 作用域当锚）：
 * identifier 只认 named import 位（importedNames），属性尾段只认 namespace/named import 的
 * base（ns.C / importedX.y）——`this.deps.x`、局部变量 `repo.x` 结构上摸不到别的文件里的
 * 容器，按名唯一也会 latch 到无关同形容器（真仓 toolRunner/deps/base 劫持实证）→ null 保守。
 * identifier 本地只剩回退容器时直接 null——同名本地声明遮蔽 import，落到全局反而可能误归因；
 * 属性尾段无遮蔽关系，本地为空继续查全局。
 * 工厂调用分支放行回退容器：callee 同名的回退容器正是该函数的返回对象，f().m() 的接收者就是它
 * （prod 工厂必然留有同名词作用域锚，跨文件走全局唯一查找不会因此劫持）。
 */
function resolveReceiver(u: UnitData, receiver: ts.Expression, containersByName: Map<string, ContainerDef[]>): ContainerDef[] | null {
    if (ts.isIdentifier(receiver)) {
        const raw = receiver.text;
        if (u.namespaceLocals.has(raw)) return null; // ns.X 是裸名层面的消费，成员计数跳过
        const local = (u.localContainers.get(raw) ?? []).filter((c) => !c.fallback);
        if (local.length > 0) return local;
        if (u.localContainers.has(raw)) return null;
        const imported = u.aliases.get(raw) ?? raw;
        if (!u.importedNames.has(imported)) return null; // 非 import 位（局部变量/未知名）不跨文件归因
        return globalUniqueContainers(containersByName, imported, false, u.isTest);
    }
    if (ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.name)) {
        const local = (u.localContainers.get(receiver.name.text) ?? []).filter((c) => !c.fallback);
        if (local.length > 0) return local;
        const base = receiver.expression;
        if (!ts.isIdentifier(base) || (!u.namespaceLocals.has(base.text) && !u.importedNames.has(u.aliases.get(base.text) ?? base.text))) return null;
        return globalUniqueContainers(containersByName, receiver.name.text, false, u.isTest); // ns.C / importedX.y：按尾段名归因
    }
    if ((ts.isCallExpression(receiver) || ts.isNewExpression(receiver)) && ts.isIdentifier(receiver.expression)) {
        const raw = receiver.expression.text;
        const local = u.localContainers.get(raw);
        if (local != null && local.length > 0) return local;
        return globalUniqueContainers(containersByName, raw, true, u.isTest); // 工厂调用 createSink().member
    }
    return null; // this / 复杂表达式：无法静态归因
}

function bareOccurrencesIn(def: InternalDef, u: UnitData, onRef: (isCall: boolean, isSelf: boolean) => void): void {
    for (const occ of u.occurrences) {
        if (occ.raw !== def.info.name) continue;
        if (u.validBindingNodes.has(occ.node)) continue;
        const isSelf = def.body != null && isInside(occ.node, def.body);
        onRef(occ.isCall, isSelf);
    }
}

function memberSitesIn(u: UnitData, onSite: (site: RawMemberSite) => void): void {
    for (const site of u.memberSites) {
        if (site.isAssignmentTarget) continue; // 纯写入不是消费
        onSite(site);
    }
}

/** 单次调用/引用按 u 的 prod/test 桶计进 refs（原 bump 闭包：refs 是单次 globalRefsOf 的累加器，引用传参即够）。 */
function bumpRef(refs: GlobalRefs, u: UnitData, isCall: boolean): void {
    if (u.isTest) {
        if (isCall) refs.testCalls += 1;
        else refs.testRefs += 1;
    } else {
        if (isCall) refs.prodCalls += 1;
        else refs.prodRefs += 1;
    }
}

function globalRefsOf(index: IndexCtx, symbol: SymbolInfo): GlobalRefs {
    const { defBySymbol, exportedTopLevelCount, unitData, containersByName } = index;
    // 编程护栏（assert 通道）：symbol 必来自本索引 defs（index.symbols / binding.member 同源），此分支不可达。
    const def = defBySymbol.get(symbol);
    assertInvariant(def != null, "nm-style: symbol 不属于本索引");
    const refs: GlobalRefs = { prodCalls: 0, prodRefs: 0, testCalls: 0, testRefs: 0 };
    // 定义文件恒参与（同文件用法是真实消费，旧 fake-exports 的 localCalls 语义）；桶：test 文件进 test，其余（含非 prod/test 路径的定义文件）进 prod。
    if (def.info.container == null) {
        const name = def.info.name;
        for (const u of unitData) {
            const isDefining = u === def.unit;
            if (!isDefining && !u.isProd && !u.isTest) continue; // 非生产/非测试路径不参与引用面
            for (const occ of u.occurrences) {
                if (isDefining ? occ.raw !== name : occ.name !== name) continue;
                if (!isDefining && !u.importedNames.has(name)) continue; // 跨文件必须有 import 才算在作用域内
                if (u.validBindingNodes.has(occ.node)) continue;
                if (def.body != null && isInside(occ.node, def.body)) continue; // 自引用剔除（spec §3.2）
                bumpRef(refs, u, occ.isCall);
            }
            if (exportedTopLevelCount.get(name) === 1) {
                for (const site of u.memberSites) {
                    if (site.member !== name || site.isAssignmentTarget) continue;
                    const expr = site.node.expression;
                    if (!ts.isIdentifier(expr) || !u.namespaceLocals.has(expr.text)) continue;
                    bumpRef(refs, u, site.isCall); // import * as ns; ns.fn() / ns.Obj
                }
            }
        }
        return refs;
    }
    const container = def.container;
    if (container == null) return refs;
    for (const u of unitData) {
        const isDefining = u === def.unit;
        if (!isDefining && !u.isProd && !u.isTest) continue;
        memberSitesIn(u, (site) => {
            if (site.member !== def.info.name) return;
            if (ts.isIdentifier(site.node.expression) && u.namespaceLocals.has(site.node.expression.text)) return; // ns.X 走裸名层面
            if (def.info.isPrivate) {
                // private class 方法：只数同文件同类（this.helper() 的接收者未知，不得跨类归因）。
                if (!isDefining || site.enclosingClassName !== container.name) return;
                bumpRef(refs, u, site.isCall);
                return;
            }
            const targets = resolveReceiver(u, site.node.expression, containersByName);
            if (targets == null || targets.includes(container)) bumpRef(refs, u, site.isCall); // 无法归因 → 保守命中全部同名成员；跨容器同名不互算
        });
        if (container.kind === "namespace") {
            // namespace 成员在本 namespace 内是裸名作用域，全仓参与文件的裸名用法都照计（防误杀；cr-func 实测跨文件无 import 的裸调用也计，保守方向）。
            bareOccurrencesIn(def, u, (isCall, isSelf) => {
                if (!isSelf) bumpRef(refs, u, isCall);
            });
        }
    }
    return refs;
}

function localRefsOf(index: IndexCtx, symbol: SymbolInfo): LocalRefs {
    const { defBySymbol, containersByName } = index;
    // 编程护栏（assert 通道）：同 globalRefsOf——symbol 必来自本索引 defs，此分支不可达。
    const def = defBySymbol.get(symbol);
    assertInvariant(def != null, "nm-style: symbol 不属于本索引");
    const u = def.unit;
    let calls = 0;
    let refs = 0;
    let selfRefs = 0;
    if (def.info.container == null || def.info.container.kind === "namespace") {
        // 顶层/嵌套函数与 namespace 成员：同文件裸名计数，自引用单列。
        bareOccurrencesIn(def, u, (isCall, isSelf) => {
            if (isSelf) selfRefs += 1;
            else if (isCall) calls += 1;
            else refs += 1;
        });
    }
    if (def.container != null) {
        const container = def.container;
        memberSitesIn(u, (site) => {
            if (site.member !== def.info.name) return;
            if (ts.isIdentifier(site.node.expression) && u.namespaceLocals.has(site.node.expression.text)) return;
            if (def.info.isPrivate) {
                if (site.enclosingClassName !== container.name) return;
            } else {
                const targets = resolveReceiver(u, site.node.expression, containersByName);
                if (targets == null || !targets.includes(container)) return; // 本地计数只认精确归因
            }
            if (site.isCall) calls += 1;
            else refs += 1;
        });
    }
    return { calls, refs, selfRefs };
}
