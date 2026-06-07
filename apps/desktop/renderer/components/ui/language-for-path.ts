import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";

export function languageExtensionForPath(path: string): Extension[] {
  const lower = path.toLowerCase();
  if (/\.(md|markdown)$/.test(lower)) {
    return [markdown()];
  }
  if (/\.json$/.test(lower)) {
    return [json()];
  }
  return [];
}
