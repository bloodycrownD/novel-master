/**
 * 给更新 UI 用的 release notes 摘要。
 *
 * CI 注入的 release body 一般是 markdown 表格，直接剥掉会留下 `|` 噪声，
 * 这里额外做表格剥离 + markdown 净化。优先读 CI 从 CHANGELOG.md 注入的
 * 「更新说明」段，没命中再回退到对应平台的下载段落。
 */

export type ReleaseNotesFocus = "desktop" | "mobile";

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

function pickPlatformSection(body: string, focus: ReleaseNotesFocus): string {
  const headings =
    focus === "desktop"
      ? ["## 下载 · Desktop", "## Desktop"]
      : ["## 下载 · Android", "## Android"];
  for (const heading of headings) {
    const section = extractSection(body, heading);
    if (section.trim()) {
      return section;
    }
  }
  return "";
}

function stripMarkdownTables(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return false;
      }
      if (trimmed.startsWith("|")) {
        return false;
      }
      if (/^[-|:.\s]+$/.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join("\n");
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[#*_>`~]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function excerptPlainSection(markdown: string): string {
  const withoutTables = stripMarkdownTables(markdown);
  return toPlainText(withoutTables);
}

function truncateExcerpt(text: string): string {
  if (text.length <= NOTES_EXCERPT_MAX) {
    return text;
  }
  return `${text.slice(0, NOTES_EXCERPT_MAX)}…`;
}

/**
 * 抽取 release notes 摘要。
 *
 * 默认 focus 是 desktop；mobile 端调用时显式传 `"mobile"`。两端调用方
 * 目前都显式传参，所以默认值更多是给单元测试或独立调用兜底。
 */
export function excerptReleaseNotes(
  body: string,
  focus: ReleaseNotesFocus = "desktop"
): string {
  const changelog = excerptPlainSection(
    extractSection(body, CHANGELOG_HEADING)
  );
  if (changelog) {
    return truncateExcerpt(changelog);
  }

  const plain = excerptPlainSection(pickPlatformSection(body, focus));

  if (!plain) {
    return FALLBACK[focus];
  }

  return truncateExcerpt(plain);
}
