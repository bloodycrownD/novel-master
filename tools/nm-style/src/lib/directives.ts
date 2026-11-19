/**
 * keep 指令统一解析（旧 inline / methods / fake-exports 三份 keepDirective 合一）。
 * 指令形态：`nm-style: keep-bare | keep-local | keep-public`；旧别名 `nm-style: public-one-ref`
 * 视为 keep-public（旧 find-fake-exports 的写法）。同一节点多条指令取源码顺序第一个。
 *
 * 修复旧 check-inline 的缺陷：箭头函数/函数表达式取 `node.parent.parent` 落到
 * VariableDeclarationList，leading comments 恒为空 → 挂在语句上的指令全部失效。
 * 正确语义：从函数节点向上找「人写注释的位置」——先看节点自身 trivia，再沿值链向上找最近的
 * 带该指令的祖先（VariableStatement / ExpressionStatement / PropertyAssignment / 成员节点）；
 * 一旦走到语句/成员锚点仍没有指令就停止，防止把文件头注释或兄弟声明的注释误挂进来
 * （guards.ts「模块注释 {@link} 被当引用」的同类机制）。
 */

import ts from "typescript";

export type KeepDirective = "keep-bare" | "keep-local" | "keep-public";

const DIRECTIVE_PATTERN = /nm-style:\s*(keep-bare|keep-local|keep-public|public-one-ref)/;
const DIRECTIVE_ALIASES: Record<string, KeepDirective> = { "keep-bare": "keep-bare", "keep-local": "keep-local", "keep-public": "keep-public", "public-one-ref": "keep-public" };

function directiveIn(text: string): KeepDirective | undefined {
  const match = DIRECTIVE_PATTERN.exec(text);
  return match == null ? undefined : DIRECTIVE_ALIASES[match[1]];
}

/**
 * 节点领先 trivia = [getFullStart(), getStart())，注释全在其中。不用 ts.getLeadingCommentRanges：
 * 它对「与前序 token 同行」的行内注释不返回（实测等号与箭头体之间的行内注释，箭头 fullStart
 * 覆盖它却查不到），而 trivia 切片里只有注释与空白，直接正则更完整也无假阳性面。
 */
function directiveAt(sourceFile: ts.SourceFile, node: ts.Node): KeepDirective | undefined {
  return directiveIn(sourceFile.text.slice(node.getFullStart(), node.getStart(sourceFile)));
}

/** 注释挂载的最外层：语句级节点与类/对象成员。锚点自身没有指令就不再向上。 */
function isCommentAnchor(node: ts.Node): boolean {
  return ts.isStatement(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

/** 任意函数形态节点（含箭头、函数表达式、方法简写）上的 nm-style keep 指令；没有则 undefined。 */
export function keepDirectiveOf(node: ts.Node): KeepDirective | undefined {
  const sourceFile = node.getSourceFile();
  if (sourceFile == null) return undefined;
  for (let current: ts.Node | undefined = node; current != null; current = current.parent) {
    const directive = directiveAt(sourceFile, current);
    if (directive != null) return directive;
    if (isCommentAnchor(current)) return undefined;
  }
  return undefined;
}
