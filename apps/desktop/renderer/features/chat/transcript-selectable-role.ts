/** 消息可见性多选：按 role 限制可勾选行（Desktop / Mobile / WebView 共用语义）。 */
export type MessageVisibilityBatchMode = "hide" | "restore";

export type TranscriptSelectableRole = "user" | "assistant" | "none";

/** 当前 batch 模式下该行是否可勾选；不可勾选时返回 `none`。 */
export function transcriptSelectableRole(
  messageRole: string,
  batchMode: MessageVisibilityBatchMode | null,
): TranscriptSelectableRole {
  if (batchMode == null) {
    return "none";
  }
  if (batchMode === "hide") {
    return messageRole === "assistant" ? "assistant" : "none";
  }
  return messageRole === "user" ? "user" : "none";
}

export function isTranscriptRowSelectable(
  role: TranscriptSelectableRole,
): boolean {
  return role !== "none";
}

/** 隐藏：hideRange(1, max(selectedAssistant.seq)) */
export function computeHideRangeFromSelection(
  messages: readonly { id: string; role: string; seq: number }[],
  selectedIds: ReadonlySet<string>,
): { fromSeq: 1; toSeq: number } | null {
  const selected = messages.filter(
    (m) => selectedIds.has(m.id) && m.role === "assistant",
  );
  if (selected.length === 0) {
    return null;
  }
  const toSeq = Math.max(...selected.map((m) => m.seq));
  return { fromSeq: 1, toSeq };
}

/** 恢复：showRange(min(selectedUser.seq), sessionMaxSeq) */
export function computeShowRangeFromSelection(
  messages: readonly { id: string; role: string; seq: number }[],
  selectedIds: ReadonlySet<string>,
  sessionMaxSeq: number,
): { fromSeq: number; toSeq: number } | null {
  const selected = messages.filter(
    (m) => selectedIds.has(m.id) && m.role === "user",
  );
  if (selected.length === 0) {
    return null;
  }
  const fromSeq = Math.min(...selected.map((m) => m.seq));
  return { fromSeq, toSeq: sessionMaxSeq };
}
