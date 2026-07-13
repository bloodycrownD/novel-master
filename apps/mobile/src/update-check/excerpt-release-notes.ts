/**
 * Human-readable release summary for update UI (mobile).
 * Mirrors desktop logic; kept separate so platform focus can diverge later.
 */

export type ReleaseNotesFocus = 'desktop' | 'mobile';

const NOTES_EXCERPT_MAX = 280;

/** CI 从 CHANGELOG.md 注入的 Release 区块标题 */
const CHANGELOG_HEADING = '## 更新说明';

const FALLBACK: Record<ReleaseNotesFocus, string> = {
  desktop:
    '新版本安装包已在 GitHub Releases 发布（Windows / macOS）。',
  mobile: '新版本 APK 已在 GitHub Releases 发布。',
};

function extractSection(body: string, heading: string): string {
  const idx = body.indexOf(heading);
  if (idx < 0) {
    return '';
  }
  const after = body.slice(idx + heading.length);
  const nextSection = after.search(/\n## /);
  return nextSection >= 0 ? after.slice(0, nextSection) : after;
}

function pickPlatformSection(body: string, focus: ReleaseNotesFocus): string {
  const headings =
    focus === 'desktop'
      ? ['## 下载 · Desktop', '## Desktop']
      : ['## 下载 · Android', '## Android'];
  for (const heading of headings) {
    const section = extractSection(body, heading);
    if (section.trim()) {
      return section;
    }
  }
  return '';
}

function stripMarkdownTables(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        return false;
      }
      if (trimmed.startsWith('|')) {
        return false;
      }
      if (/^[-|:.\s]+$/.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join('\n');
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[#*_>`~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
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

/** 优先读取 CI 从 CHANGELOG.md 注入的「更新说明」；否则回退到平台下载段落。 */
export function excerptReleaseNotes(
  body: string,
  focus: ReleaseNotesFocus = 'mobile',
): string {
  const changelog = excerptPlainSection(extractSection(body, CHANGELOG_HEADING));
  if (changelog) {
    return truncateExcerpt(changelog);
  }

  const plain = excerptPlainSection(pickPlatformSection(body, focus));

  if (!plain) {
    return FALLBACK[focus];
  }

  return truncateExcerpt(plain);
}
