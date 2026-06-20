/** 消息可见性多选：按 role 限制可勾选行（Desktop / Mobile / WebView 共用语义）。 */

import {
  computeTailBatchRangeFromSelection,
  selectTailBatchEligibleIdsFromAnchor as selectTailEligibleFromAnchor,
  type TailBatchRow,
} from "./tail-batch-range.js";

export type MessageVisibilityBatchMode = "hide" | "restore";

export type TranscriptSelectableRole = "user" | "assistant" | "none";

/** 参与可见性批量范围计算的最小消息字段。 */
export type VisibilityBatchMessage = {
  readonly id: string;
  readonly role: string;
  readonly seq: number;
};

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

/** 该行在当前 batch 模式下是否可勾选。 */
export function isTranscriptRowSelectable(
  role: TranscriptSelectableRole,
): boolean {
  return role !== "none";
}

/** 隐藏：hideRange(1, max(selectedAssistant.seq)) */
export function computeHideRangeFromSelection(
  messages: readonly VisibilityBatchMessage[],
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

/**
 * 恢复：showRange(min(selected.seq), sessionMaxSeq)。
 *
 * @deprecated 请改用 {@link computeTailBatchRangeFromSelection}（restore / delete 共用）。
 */
export function computeShowRangeFromSelection(
  messages: readonly VisibilityBatchMessage[],
  selectedIds: ReadonlySet<string>,
  sessionMaxSeq: number,
): { fromSeq: number; toSeq: number } | null {
  return computeTailBatchRangeFromSelection(
    toTailBatchRows(messages),
    selectedIds,
    sessionMaxSeq,
  );
}

function toTailBatchRows(
  messages: readonly VisibilityBatchMessage[],
): readonly TailBatchRow[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    seq: m.seq,
    selectable: m.role === "user",
  }));
}

/**
 * 计算可见性批量操作将影响的消息 id 集合（范围预览）。
 *
 * - **hide**：有选中 assistant 时，所有 `seq <= max(selectedAssistant.seq)` 的消息 id（含 user/assistant）
 * - **restore**：有选中 user 时，所有 `seq >= min(selectedUser.seq)` 的消息 id
 */
export function computeVisibilityBatchAffectedIds(
  messages: readonly VisibilityBatchMessage[],
  mode: MessageVisibilityBatchMode | null,
  selectedIds: ReadonlySet<string>,
  sessionMaxSeq: number,
): ReadonlySet<string> {
  if (mode == null) {
    return new Set();
  }
  if (mode === "hide") {
    const range = computeHideRangeFromSelection(messages, selectedIds);
    if (range == null) {
      return new Set();
    }
    return new Set(
      messages.filter((m) => m.seq <= range.toSeq).map((m) => m.id),
    );
  }
  const range = computeTailBatchRangeFromSelection(
    toTailBatchRows(messages),
    selectedIds,
    sessionMaxSeq,
  );
  if (range == null) {
    return new Set();
  }
  return new Set(
    messages.filter((m) => m.seq >= range.fromSeq).map((m) => m.id),
  );
}

/**
 * 以锚点消息为界，计算可见性批量应勾选的可选行 id（先重置再范围全选）。
 *
 * - **hide**：锚点为 assistant → 勾选所有 `seq <= anchor.seq` 的 assistant
 * - **restore**：锚点为 user → 勾选所有 `seq >= anchor.seq` 的 user
 */
export function selectVisibilityBatchEligibleIdsFromAnchor(
  messages: readonly VisibilityBatchMessage[],
  mode: MessageVisibilityBatchMode,
  anchorId: string,
): ReadonlySet<string> {
  const anchor = messages.find((m) => m.id === anchorId);
  if (anchor == null) {
    return new Set();
  }
  if (mode === "hide") {
    if (anchor.role !== "assistant") {
      return new Set();
    }
    return new Set(
      messages
        .filter((m) => m.role === "assistant" && m.seq <= anchor.seq)
        .map((m) => m.id),
    );
  }
  if (anchor.role !== "user") {
    return new Set();
  }
  return selectTailEligibleFromAnchor(toTailBatchRows(messages), anchorId);
}
