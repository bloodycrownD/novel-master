/**
 * WebView 通用主题模式推断（chat-transcript / rich-document 共享）。
 * 亮度阈值 0.5，算法与 mermaid 主题推断同源（自 mermaid-core 抽出复用）；
 * 推断结果写入 documentElement.dataset.nmMode，供 token CSS 两套配色切换。
 */

export type ThemeMode = 'dark' | 'light';

/** 解析 #rgb/#rrggbb/#rrggbbaa/rgb() 颜色为 [r,g,b]；无法解析返回 null。 */
export function parseColorToRgb(
  color: string,
): [number, number, number] | null {
  const trimmed = color.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(trimmed);
  if (m) {
    const hex = m[1]!;
    if (hex.length === 3 || hex.length === 4) {
      return [
        parseInt(hex[0]! + hex[0]!, 16),
        parseInt(hex[1]! + hex[1]!, 16),
        parseInt(hex[2]! + hex[2]!, 16),
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}

/** 按背景亮度推断模式：暗底 dark，亮底 light；无法解析按 light。 */
export function inferThemeModeFromBg(bg: string | null | undefined): ThemeMode {
  if (!bg) {
    return 'light';
  }
  const rgb = parseColorToRgb(bg);
  if (!rgb) {
    return 'light';
  }
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance < 0.5 ? 'dark' : 'light';
}
