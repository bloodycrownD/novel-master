/**
 * restore / delete 批量模式共用的 tail 级联范围计算。
 *
 * @module domain/chat/logic/tail-batch-range
 */

/** restore 与 delete 批量模式（级联规则相同，仅确认 API 不同）。 */
export type TailBatchMode = "restore" | "delete";

/** 参与 tail 批量范围计算的最小行字段。 */
export type TailBatchRow = {
  readonly id: string;
  readonly role: string;
  readonly seq: number;
  readonly hidden: boolean;
  /** 合成行（如 user_vfs_turn 卡片）仍为 true */
  readonly selectable: boolean;
};

/**
 * delete：仅未隐藏且可选；restore：仅已隐藏且可选。
 */
export function isTailBatchRowSelectable(
  row: TailBatchRow,
  mode: TailBatchMode,
): boolean {
  if (!row.selectable) {
    return false;
  }
  if (mode === "delete") {
    return !row.hidden;
  }
  return row.hidden;
}

/**
 * 以锚点消息为界，计算 tail 批量应勾选的可选行 id（先重置再范围全选）。
 *
 * 锚点可选时，勾选所有 `seq >= anchor.seq` 且符合 mode 可选规则的行。
 */
export function selectTailBatchEligibleIdsFromAnchor(
  rows: readonly TailBatchRow[],
  anchorId: string,
  mode: TailBatchMode,
): ReadonlySet<string> {
  const anchor = rows.find((r) => r.id === anchorId);
  if (anchor == null || !isTailBatchRowSelectable(anchor, mode)) {
    return new Set();
  }
  return new Set(
    rows
      .filter(
        (r) => isTailBatchRowSelectable(r, mode) && r.seq >= anchor.seq,
      )
      .map((r) => r.id),
  );
}

/**
 * 计算 tail 批量操作将影响的消息 id 集合（范围预览）。
 *
 * 有有效选中时，包含所有 `seq >= min(selected.seq)` 的消息 id（全 role，含 hidden）。
 */
export function computeTailBatchAffectedIds(
  rows: readonly TailBatchRow[],
  selectedIds: ReadonlySet<string>,
  _sessionMaxSeq: number,
): ReadonlySet<string> {
  const selected = rows.filter(
    (r) => selectedIds.has(r.id) && r.selectable,
  );
  if (selected.length === 0) {
    return new Set();
  }
  const fromSeq = Math.min(...selected.map((r) => r.seq));
  return new Set(
    rows.filter((r) => r.seq >= fromSeq).map((r) => r.id),
  );
}

/**
 * 从当前选中集计算 showRange / truncate 用的 seq 范围。
 *
 * @returns `{ fromSeq: min(selected.seq), toSeq: sessionMaxSeq }` 或 null
 */
export function computeTailBatchRangeFromSelection(
  rows: readonly TailBatchRow[],
  selectedIds: ReadonlySet<string>,
  sessionMaxSeq: number,
  mode: TailBatchMode,
): { fromSeq: number; toSeq: number } | null {
  const selected = rows.filter(
    (r) => selectedIds.has(r.id) && isTailBatchRowSelectable(r, mode),
  );
  if (selected.length === 0) {
    return null;
  }
  const fromSeq = Math.min(...selected.map((r) => r.seq));
  return { fromSeq, toSeq: sessionMaxSeq };
}

/** delete 确认：`afterSeq = fromSeq - 1`（保留 fromSeq 及之前）。 */
export function tailBatchDeleteAfterSeq(fromSeq: number): number {
  return fromSeq - 1;
}
