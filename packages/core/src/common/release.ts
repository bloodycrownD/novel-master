/**
 * 更新检查 / 发布域工具：App 版本号比较、release notes 摘要。
 *
 * 两者只服务 desktop / mobile 的 update-check 链路，同属一个类别文件。
 *
 * @module common/release
 */

import {truncateText} from "./text.js";

function parseParts(version: string): [number, number, number] {
    const parts = version.split(".");
    if (parts.length !== 3) {
        throw new Error(`无效的版本号: ${version}`);
    }
    const nums = parts.map((p) => {
        const n = Number.parseInt(p, 10);
        if (!Number.isFinite(n) || n < 0) {
            throw new Error(`无效的版本号: ${version}`);
        }
        return n;
    });
    return [nums[0]!, nums[1]!, nums[2]!];
}

/**
 * App 版本号比较（只认 major.minor.patch 三段纯数字）。
 *
 * 返回值约定：local 比 remote 旧返回 -1，相等返回 0，更新返回 1。
 */
export function compareAppVersions(local: string, remote: string): -1 | 0 | 1 {
    const [lMajor, lMinor, lPatch] = parseParts(local);
    const [rMajor, rMinor, rPatch] = parseParts(remote);
    if (lMajor !== rMajor) {
        return lMajor < rMajor ? -1 : 1;
    }
    if (lMinor !== rMinor) {
        return lMinor < rMinor ? -1 : 1;
    }
    if (lPatch !== rPatch) {
        return lPatch < rPatch ? -1 : 1;
    }
    return 0;
}

type ReleaseNotesFocus = "desktop" | "mobile";

const NOTES_EXCERPT_MAX = 280;

/** CI 从 CHANGELOG.md 注入的 Release 区块标题 */
const CHANGELOG_HEADING = "## 更新说明";

const FALLBACK: Record<ReleaseNotesFocus, string> = {
    desktop: "新版本安装包已在 GitHub Releases 发布（Windows / macOS）。",
    mobile: "新版本 APK 已在 GitHub Releases 发布。",
};

function extractSection(body: string, heading: string): string {
    const idx = body.indexOf(heading);
    if (idx < 0) {
        return "";
    }
    const after = body.slice(idx + heading.length);
    const nextSection = after.search(/\n## /);
    return nextSection >= 0 ? after.slice(0, nextSection) : after;
}

function excerptPlainSection(markdown: string): string {
    const lines = markdown.split("\n");
    const textLines = lines.filter((line) => {
        const trimmed = line.trim();
        return trimmed !== "" && !trimmed.startsWith("|") && !/^[-|:.\s]+$/.test(trimmed);
    });
    const withoutTables = textLines.join("\n");
    const withoutCodeBlocks = withoutTables.replace(/```[\s\S]*?```/g, "");
    const withoutLinks = withoutCodeBlocks.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const withoutBold = withoutLinks.replace(/\*\*([^*]+)\*\*/g, "$1");
    const withoutInlineCode = withoutBold.replace(/`([^`]+)`/g, "$1");
    const withoutHeadings = withoutInlineCode.replace(/^#+\s*/gm, "");
    const withoutMarkers = withoutHeadings.replace(/[#*_>`~]/g, "");
    const collapsed = withoutMarkers.replace(/\n{3,}/g, "\n\n");
    return collapsed.replace(/[ \t]+\n/g, "\n").trim();
}

function truncateExcerpt(text: string): string {
    return truncateText(text, NOTES_EXCERPT_MAX);
}

/**
 * 抽取 release notes 摘要。
 *
 * CI 注入的 release body 一般是 markdown 表格，直接剥掉会留下 `|` 噪声，
 * 这里额外做表格剥离 + markdown 净化。优先读 CI 从 CHANGELOG.md 注入的
 * 「更新说明」段，没命中再回退到对应平台的下载段落。
 *
 * 默认 focus 是 desktop；mobile 端调用时显式传 `"mobile"`。两端调用方
 * 目前都显式传参，所以默认值更多是给单元测试或独立调用兜底。
 */
export function excerptReleaseNotes(body: string, focus: ReleaseNotesFocus = "desktop"): string {
    const changelog = excerptPlainSection(extractSection(body, CHANGELOG_HEADING));
    if (changelog) {
        return truncateExcerpt(changelog);
    }
    const headings = focus === "desktop" ? ["## 下载 · Desktop", "## Desktop"] : ["## 下载 · Android", "## Android"];
    const platformSection = headings.map((heading) => extractSection(body, heading)).find((section) => section.trim()) ?? "";
    const plain = excerptPlainSection(platformSection);
    if (!plain) {
        return FALLBACK[focus];
    }
    return truncateExcerpt(plain);
}
