/**
 * Human-readable release summary for update UI.
 * CI release bodies are markdown tables; raw stripping leaves pipe noise.
 */

export type ReleaseNotesFocus = "desktop" | "mobile";

const NOTES_EXCERPT_MAX = 280;

const FALLBACK: Record<ReleaseNotesFocus, string> = {
  desktop:
    "新版本安装包已在 GitHub Releases 发布（Windows / macOS）。",
  mobile: "新版本 APK 已在 GitHub Releases 发布。",
};

function extractSection(body: string, heading: string): string {
  const idx = body.indexOf(heading);
  if (idx < 0) {
    return body;
  }
  const after = body.slice(idx + heading.length);
  const nextSection = after.search(/\n## /);
  return nextSection >= 0 ? after.slice(0, nextSection) : after;
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

/**
 * Prefer the platform section from workflow-generated release notes.
 */
export function excerptReleaseNotes(
  body: string,
  focus: ReleaseNotesFocus = "desktop",
): string {
  const sectionHeading = focus === "desktop" ? "## Desktop" : "## Android";
  const scoped = extractSection(body, sectionHeading);
  const withoutTables = stripMarkdownTables(scoped);
  const plain = toPlainText(withoutTables);

  if (!plain) {
    return FALLBACK[focus];
  }

  if (plain.length <= NOTES_EXCERPT_MAX) {
    return plain;
  }
  return `${plain.slice(0, NOTES_EXCERPT_MAX)}…`;
}
