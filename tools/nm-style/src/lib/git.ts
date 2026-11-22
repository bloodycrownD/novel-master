/**
 * git 相关工具：diff 行提取、改动文件集、新增行配对过滤、HEAD 导出名兜底、主仓根定位。
 * 纪律：git 调用失败一律 console.error + 返回明确空值/null，绝不静默吞（旧 1MB maxBuffer 静默失效的教训）。
 * 与 core.ts 互相导入（core.collectFiles 用 changedFiles，本模块用 toPosix）——只在函数体内引用，
 * ESM 对提升的函数声明的循环依赖是安全的。
 */

import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { toPosix } from "./core.js";

const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** bare-exports 口径的顶层 export function（含 async / 生成器）；headExportFnNames 与 bare-exports 规则共用同一正则。 */
export const BARE_EXPORT_FN = /^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 跑一条 git 命令，按行返回非空输出；失败（含大 diff 超 buffer）打印原因并返回空数组。 */
export function gitLines(command: string): string[] {
    try {
        return execSync(command, { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER }).trim().split(/\r?\n/).filter(Boolean);
    } catch (error) {
        console.error(`nm-style: git 命令失败（${command}），按空输出处理 —— ${errorMessage(error)}`);
        return [];
    }
}

/** 改动文件集：已跟踪的增/改/拷 + 未跟踪新文件（posix 相对路径）。 */
export function changedFiles(): string[] {
    return [...gitLines("git diff HEAD --name-only --diff-filter=ACM"), ...gitLines("git ls-files --others --exclude-standard")];
}

export type AddedLinePredicate = (file: string, line: number) => boolean;

/**
 * `--changed` 时只报新增行；未跟踪文件视为整文件新增。
 * hunk 内「删了又加」的行（行尾变化、同 hunk 重排）按内容配对后不算新增——只报真正新增内容的行，
 * 否则触碰大文件时既有拆行会被当成新增债报出。跨 hunk 移动不在此配对（bare-exports 段另有 HEAD 兜底）。
 * 旧实现边界（忠实保留）：某文件的变更全部被配对吃掉时不进 addedLines，谓词与未跟踪文件同走
 * 「整文件新增」分支——该文件所有行都按新增报。
 */
/** hunk 内删行配对：吃掉一条已登记的删行计数（removedInHunk 按 Map 引用传入）。 */
function consumeRemoved(removedInHunk: Map<string, number>, text: string): void {
    const count = removedInHunk.get(text) ?? 0;
    if (count > 0) removedInHunk.set(text, count - 1);
}

export function addedLineFilter(changed: boolean): AddedLinePredicate {
    if (!changed) return () => true;
    const addedLines = new Map<string, Set<number>>();
    let current: string | null = null;
    let plusLine = 0;
    let removedInHunk = new Map<string, number>();
    for (const raw of gitLines("git diff HEAD -U0")) {
        const line = raw.replace(/\r$/, "");
        if (line.startsWith("diff --git ")) {
            current = null;
        } else if (line.startsWith("+++ b/")) {
            current = line.slice(6);
        } else if (current != null && line.startsWith("@@")) {
            const match = /\+(\d+)(?:,(\d+))?/.exec(line);
            plusLine = match == null ? 0 : Number(match[1]);
            removedInHunk = new Map();
        } else if (current != null && line.startsWith("-") && !line.startsWith("---")) {
            const text = line.slice(1);
            removedInHunk.set(text, (removedInHunk.get(text) ?? 0) + 1);
        } else if (current != null && line.startsWith("+") && !line.startsWith("+++")) {
            const text = line.slice(1);
            if ((removedInHunk.get(text) ?? 0) > 0) {
                consumeRemoved(removedInHunk, text);
            } else {
                const set = addedLines.get(current) ?? new Set<number>();
                set.add(plusLine);
                addedLines.set(current, set);
            }
            plusLine += 1;
        }
    }
    return (file, line) => {
        const set = addedLines.get(toPosix(file));
        return set == null || set.has(line);
    };
}

/**
 * `git show HEAD:<file>` 的顶层 export function 名集合；文件不在 HEAD（新增文件）或 git 不可用时
 * 返回 null（不做豁免）。调用方用集合判「HEAD 已有同名导出 → 不算新增」。
 */
export function headExportFnNames(relFile: string): Set<string> | null {
    const result = spawnSync("git", ["show", `HEAD:${toPosix(relFile)}`], { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
    if (result.error != null) console.error(`nm-style: git show 执行失败 —— ${errorMessage(result.error)}`);
    if (result.status !== 0 || result.stdout == null) return null;
    const names = new Set<string>();
    for (const line of result.stdout.split(/\r?\n/)) {
        const match = BARE_EXPORT_FN.exec(line);
        if (match != null) names.add(match[1]);
    }
    return names;
}

/** 被扫仓若是 worktree，定位共享主仓根（git common dir 的上一层）；失败打印原因并返回 null，调用方自行降级。 */
export function worktreeMainRoot(): string | null {
    try {
        const commonDir = execSync("git rev-parse --git-common-dir", { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER }).trim();
        if (commonDir.length === 0) return null;
        return path.resolve(process.cwd(), commonDir, "..");
    } catch (error) {
        console.error(`nm-style: git rev-parse --git-common-dir 失败，无法定位主仓根 —— ${errorMessage(error)}`);
        return null;
    }
}
