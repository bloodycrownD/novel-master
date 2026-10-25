/**
 * 给更新 UI 用的 release notes 摘要。
 *
 * CI 注入的 release body 一般是 markdown 表格，直接剥掉会留下 `|` 噪声，
 * 这里额外做表格剥离 + markdown 净化。优先读 CI 从 CHANGELOG.md 注入的
 * 「更新说明」段，没命中再回退到对应平台的下载段落。
 */

import { truncateText } from "./text.js";

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
