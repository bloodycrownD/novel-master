/**
 * 手输 `@` typeahead：最多 5 条；点选插入完整 `@path`。
 */
import { coreT } from "@shared/logic/core-i18n";
import { composerAtPath, type AtPathRef } from "./composer-at-path";

type AtPathTypeaheadProps = {
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
            aria-label={coreT({key: "ui.chat.file_path_suggest_aria"})}
        >
            {candidates.map((ref) => {
                const token = composerAtPath.formatToken(ref.path, ref.kind === "dir");
                if (!token.ok) {
                    return null;
                }
                const label = ref.kind === "dir" ? `📁${ref.path}/` : `📄${ref.path}`;
                return (
                    <li key={`${ref.kind}:${ref.path}`} role="option">
                        <button
                            type="button"
                            className="chat-composer__typeahead-item"
                            onMouseDown={(e) => {
                                // 避免抢 textarea blur 导致点选失败
                                e.preventDefault();
                                onSelect(token.value);
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
