import type {MixedStyleRecord} from 'react-native-render-html';

const OPEN_TAG_RE = /<([a-z][a-z0-9]*)(\s[^>]*?)>/gi;

function appendClassAttribute(attrs: string, className: string): string {
  const classMatch = attrs.match(/\bclass=(["'])(.*?)\1/i);
  if (classMatch) {
    const quote = classMatch[1];
    const existing = classMatch[2].trim();
    const merged = existing ? `${existing} ${className}` : className;
    return attrs.replace(classMatch[0], `class=${quote}${merged}${quote}`);
  }
  return `${attrs} class="${className}"`;
}

function stripColorFromStyle(style: string): string {
  return style
    .replace(/\bcolor\s*:\s*[^;]+;?/gi, '')
    .replace(/^\s*;+\s*|\s*;+\s*$/g, '')
    .trim();
}

/**
 * Converts inline `color` declarations into RenderHTML classesStyles entries.
 * More reliable than CSS inline processing when default bubble text color is set.
 */
export function materializeInlineColors(
  html: string,
  classesStyles: Record<string, MixedStyleRecord>,
): string {
  const colorToClass = new Map<string, string>();

  const classForColor = (colorValue: string): string => {
    const normalized = colorValue.trim();
    const existing = colorToClass.get(normalized);
    if (existing != null) {
      return existing;
    }
    const className = `nm-inline-c-${colorToClass.size}`;
    colorToClass.set(normalized, className);
    classesStyles[className] = {color: normalized};
    return className;
  };

  return html.replace(OPEN_TAG_RE, (full, tag: string, attrs: string) => {
    const styleMatch = attrs.match(/\bstyle=(["'])([\s\S]*?)\1/i);
    if (styleMatch == null) {
      return full;
    }
    const quote = styleMatch[1];
    const style = styleMatch[2];
    const colorMatch = style.match(/\bcolor\s*:\s*([^;]+)/i);
    if (colorMatch == null) {
      return full;
    }

    const className = classForColor(colorMatch[1]);
    let nextAttrs = appendClassAttribute(attrs, className);
    const restStyle = stripColorFromStyle(style);
    if (restStyle) {
      nextAttrs = nextAttrs.replace(
        styleMatch[0],
        `style=${quote}${restStyle}${quote}`,
      );
    } else {
      nextAttrs = nextAttrs.replace(styleMatch[0], '').replace(/\s+/g, ' ').trim();
      nextAttrs = nextAttrs.length > 0 ? ` ${nextAttrs}` : '';
    }

    return `<${tag}${nextAttrs}>`;
  });
}
