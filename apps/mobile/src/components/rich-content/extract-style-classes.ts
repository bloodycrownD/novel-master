import type {MixedStyleRecord} from 'react-native-render-html';

/** Camel-case a single CSS property for React Native style keys. */
function cssPropToRn(prop: string): string {
  return prop.trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Parses a minimal subset of CSS (`.class { prop: value; }`) into RenderHTML classesStyles.
 * Complex selectors and @rules are skipped on purpose.
 */
export function parseSimpleCssToClasses(css: string): Record<string, MixedStyleRecord> {
  const classes: Record<string, MixedStyleRecord> = {};
  const ruleRe = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(css)) !== null) {
    const className = match[1];
    const body = match[2];
    const style: MixedStyleRecord = {};
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon === -1) {
        continue;
      }
      const key = cssPropToRn(decl.slice(0, colon));
      const value = decl.slice(colon + 1).trim();
      if (key && value) {
        (style as Record<string, string>)[key] = value;
      }
    }
    if (Object.keys(style).length > 0) {
      classes[className] = {...classes[className], ...style};
    }
  }
  return classes;
}

/**
 * Pulls `<style>` blocks out of HTML and merges rules into classesStyles (M2 spec path).
 */
export function extractStyleBlocksFromHtml(html: string): {
  htmlWithoutStyle: string;
  classesStyles: Record<string, MixedStyleRecord>;
} {
  const classesStyles: Record<string, MixedStyleRecord> = {};
  const htmlWithoutStyle = html.replace(
    /<style[^>]*>([\s\S]*?)<\/style>/gi,
    (_full, css: string) => {
      const parsed = parseSimpleCssToClasses(css);
      for (const [name, style] of Object.entries(parsed)) {
        classesStyles[name] = {...classesStyles[name], ...style};
      }
      return '';
    },
  );
  return {htmlWithoutStyle, classesStyles};
}
