/**
 * Simple `key: value` rows from YAML-style front matter lines (display only).
 */
export interface FrontMatterField {
  key: string;
  value: string;
}

export function parseFrontMatterFields(lines: string[]): FrontMatterField[] {
  const fields: FrontMatterField[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon > 0) {
      fields.push({
        key: trimmed.slice(0, colon).trim(),
        value: trimmed.slice(colon + 1).trim(),
      });
    } else {
      fields.push({key: '', value: trimmed});
    }
  }
  return fields;
}
