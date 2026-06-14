/**
 * Transcript 内 `<user-vfs-action>` 最小展开渲染（edit-hunk old/new）。
 */

export type ParsedUserVfsEditHunk = {
  readonly index: string;
  readonly old: string;
  readonly new: string;
};

export type ParsedUserVfsAction = {
  readonly kind: string;
  readonly path: string;
  readonly method?: string;
  readonly hunks: readonly ParsedUserVfsEditHunk[];
};

const USER_VFS_ACTION_RE =
  /<user-vfs-action\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/user-vfs-action>)/;
const EDIT_HUNK_RE =
  /<edit-hunk[^>]*index="(\d+)"[^>]*>[\s\S]*?<old>([\s\S]*?)<\/old>[\s\S]*?<new>([\s\S]*?)<\/new>[\s\S]*?<\/edit-hunk>/g;

/** 从 user 消息纯文本解析首个 user-vfs-action；非 VFS 操作返回 null。 */
export function parseUserVfsActionFromText(
  text: string,
): ParsedUserVfsAction | null {
  if (!text.includes("<user-vfs-action")) {
    return null;
  }
  const match = text.match(USER_VFS_ACTION_RE);
  if (match == null) {
    return null;
  }
  const attrs = match[1] ?? "";
  const inner = match[2] ?? "";
  const kind = attrs.match(/kind="([^"]+)"/)?.[1] ?? "";
  const path = attrs.match(/path="([^"]+)"/)?.[1] ?? "";
  const method = attrs.match(/method="([^"]+)"/)?.[1];
  const hunks: ParsedUserVfsEditHunk[] = [];
  const hunkRe = new RegExp(EDIT_HUNK_RE.source, "g");
  let hm: RegExpExecArray | null;
  while ((hm = hunkRe.exec(inner)) !== null) {
    hunks.push({ index: hm[1] ?? "", old: hm[2] ?? "", new: hm[3] ?? "" });
  }
  return { kind, path, method, hunks };
}

interface UserVfsActionBodyProps {
  readonly action: ParsedUserVfsAction;
}

/** user 气泡内 VFS 操作卡片（可折叠 edit-hunk）。 */
export function UserVfsActionBody({ action }: UserVfsActionBodyProps) {
  return (
    <div className="vfs-action-card">
      <div className="vfs-action-title">
        {action.kind} · {action.path}
      </div>
      {action.method ? (
        <div className="vfs-action-meta">method: {action.method}</div>
      ) : null}
      {action.hunks.map((hunk) => (
        <details key={hunk.index} className="edit-hunk">
          <summary>edit-hunk #{hunk.index}</summary>
          <div className="edit-hunk-old">
            <span className="edit-hunk-label">old</span>
            <pre>{hunk.old}</pre>
          </div>
          <div className="edit-hunk-new">
            <span className="edit-hunk-label">new</span>
            <pre>{hunk.new}</pre>
          </div>
        </details>
      ))}
    </div>
  );
}
