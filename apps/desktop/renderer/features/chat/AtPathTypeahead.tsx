/**
 * 手输 `@` typeahead：最多 5 条；点选插入完整 `@path`。
 */
import type { AtPathRef } from "./composer-at-path";
import { formatComposerAtPathToken } from "./composer-at-path";

export type AtPathTypeaheadProps = {
  open: boolean;
  candidates: readonly AtPathRef[];
  onSelect: (token: string) => void;
};

export function AtPathTypeahead({
  open,
  candidates,
  onSelect,
}: AtPathTypeaheadProps) {
  if (!open || candidates.length === 0) {
    return null;
  }
  return (
    <ul
      className="chat-composer__typeahead"
      role="listbox"
      aria-label="文件路径建议"
    >
      {candidates.map((ref) => {
        const token = formatComposerAtPathToken(ref.path, ref.kind === "dir");
        const label = ref.kind === "dir" ? `📁${ref.path}/` : `📄${ref.path}`;
        return (
          <li key={`${ref.kind}:${ref.path}`} role="option">
            <button
              type="button"
              className="chat-composer__typeahead-item"
              onMouseDown={(e) => {
                // 避免抢 textarea blur 导致点选失败
                e.preventDefault();
                onSelect(token);
              }}
            >
              {label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
