import { entryName } from "../features/workspace/vfs-tree-utils";

const MARKDOWN_EXT = /\.(md|markdown)$/i;

export function isMarkdownPreviewPath(path: string): boolean {
  return MARKDOWN_EXT.test(path);
}

function hasFileExtension(path: string): boolean {
  const name = entryName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0;
}

/** Heuristic for extensionless files that contain markdown syntax. */
export function isLikelyMarkdownContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("---")) {
    return true;
  }
  return (
    /^#{1,6}\s/m.test(trimmed) ||
    /^[-*+]\s/m.test(trimmed) ||
    /^\d+\.\s/m.test(trimmed)
  );
}

export function shouldRenderMarkdownPreview(
  path: string,
  content: string,
): boolean {
  if (isMarkdownPreviewPath(path)) {
    return true;
  }
  if (hasFileExtension(path)) {
    return false;
  }
  return isLikelyMarkdownContent(content);
}
