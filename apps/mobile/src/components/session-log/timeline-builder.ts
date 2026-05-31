/**
 * Merges chat tool_use/tool_result pairs with sessionFs batches into a reverse-chronological timeline.
 */
import type {ChatMessage, SessionFsBatchSummary} from '@novel-master/core';
import {
  buildToolResultByUseId,
  toolCallSummary,
  toolCallViewFromUse,
  type ToolCallView,
} from '../chat/message-blocks';

export type TimelineToolStatus = 'success' | 'error' | 'pending';

export interface TimelineToolItem {
  readonly kind: 'tool';
  readonly id: string;
  readonly toolUseId: string;
  readonly name: string;
  readonly summary: string;
  readonly status: TimelineToolStatus;
  readonly createdAtMs: number;
  readonly linkedBatchId?: string;
  readonly expired: boolean;
}

export interface TimelineCheckpointItem {
  readonly kind: 'checkpoint';
  readonly batchId: string;
  readonly createdAtMs: number;
  readonly createdBy: string;
  readonly sourceLabel: string;
  readonly pathSummary: string;
  readonly expired: boolean;
}

export type TimelineItem = TimelineToolItem | TimelineCheckpointItem;

export interface BuildTimelineOptions {
  readonly checkpointRetention: number;
  /** Test-only: force these batch ids to appear expired regardless of retention. */
  readonly mockExpiredBatchIds?: ReadonlySet<string>;
}

function blocks(message: ChatMessage) {
  return message.content.blocks ?? [];
}

function checkpointSourceLabel(createdBy: string, linkedToolName?: string): string {
  if (createdBy === 'user') {
    return '手动保存';
  }
  if (createdBy === 'assistant' && linkedToolName) {
    return `工具执行 (${linkedToolName})`;
  }
  if (createdBy === 'assistant') {
    return '工具执行';
  }
  return `来源: ${createdBy}`;
}

function batchPathSummary(batch: SessionFsBatchSummary): string {
  const short = batch.id.length > 12 ? `${batch.id.slice(0, 8)}…` : batch.id;
  return `检查点 ${short}`;
}

function computeExpiredBatchIds(
  batches: readonly SessionFsBatchSummary[],
  retention: number,
  mockExpired?: ReadonlySet<string>,
): Set<string> {
  const expired = new Set<string>(mockExpired ?? []);
  const safeRetention = Math.max(1, Math.floor(retention));
  const sorted = [...batches].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const overflow = sorted.length - safeRetention;
  if (overflow > 0) {
    for (let i = 0; i < overflow; i += 1) {
      expired.add(sorted[i]!.id);
    }
  }
  return expired;
}

function linkToolsToBatches(
  tools: TimelineToolItem[],
  batches: readonly SessionFsBatchSummary[],
): TimelineToolItem[] {
  const sortedBatches = [...batches].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const usedBatchIds = new Set<string>();

  return tools.map(tool => {
    let best: SessionFsBatchSummary | undefined;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const batch of sortedBatches) {
      if (usedBatchIds.has(batch.id)) {
        continue;
      }
      const delta = batch.createdAtMs - tool.createdAtMs;
      if (delta < 0 || delta > 120_000) {
        continue;
      }
      if (delta < bestDelta) {
        bestDelta = delta;
        best = batch;
      }
    }
    if (best) {
      usedBatchIds.add(best.id);
      return {...tool, linkedBatchId: best.id};
    }
    return tool;
  });
}

function toolStatus(view: ToolCallView): TimelineToolStatus {
  if (view.status === 'pending') {
    return 'pending';
  }
  return view.status === 'error' ? 'error' : 'success';
}

/** Builds merged timeline items sorted newest-first. */
export function buildTimeline(
  messages: readonly ChatMessage[],
  batches: readonly SessionFsBatchSummary[],
  options: BuildTimelineOptions,
): TimelineItem[] {
  const visible = messages.filter(m => !m.hidden);
  const results = buildToolResultByUseId(visible);
  const expiredBatchIds = computeExpiredBatchIds(
    batches,
    options.checkpointRetention,
    options.mockExpiredBatchIds,
  );

  const toolItems: TimelineToolItem[] = [];
  for (const message of visible) {
    if (message.role !== 'assistant') {
      continue;
    }
    for (const block of blocks(message)) {
      if (block.type !== 'tool_use') {
        continue;
      }
      const view = toolCallViewFromUse(block, results);
      toolItems.push({
        kind: 'tool',
        id: `tool-${block.id}`,
        toolUseId: block.id,
        name: block.name,
        summary: toolCallSummary(view) || block.name,
        status: toolStatus(view),
        createdAtMs: message.createdAtMs,
        expired: false,
      });
    }
  }

  const linkedTools = linkToolsToBatches(toolItems, batches);
  const toolByBatchId = new Map<string, TimelineToolItem>();
  for (const tool of linkedTools) {
    if (tool.linkedBatchId) {
      toolByBatchId.set(tool.linkedBatchId, tool);
    }
  }

  const toolsWithExpiry = linkedTools.map(tool => ({
    ...tool,
    expired: tool.linkedBatchId
      ? expiredBatchIds.has(tool.linkedBatchId)
      : false,
  }));

  const checkpointItems: TimelineCheckpointItem[] = batches.map(batch => {
    const linked = toolByBatchId.get(batch.id);
    return {
      kind: 'checkpoint',
      batchId: batch.id,
      createdAtMs: batch.createdAtMs,
      createdBy: batch.createdBy,
      sourceLabel: checkpointSourceLabel(batch.createdBy, linked?.name),
      pathSummary: batchPathSummary(batch),
      expired: expiredBatchIds.has(batch.id),
    };
  });

  const merged: TimelineItem[] = [...toolsWithExpiry, ...checkpointItems];
  merged.sort((a, b) => {
    const ta = a.createdAtMs;
    const tb = b.createdAtMs;
    if (tb !== ta) {
      return tb - ta;
    }
    if (a.kind === b.kind) {
      return 0;
    }
    return a.kind === 'tool' ? -1 : 1;
  });
  return merged;
}

export function formatRelativeTimeMs(nowMs: number, thenMs: number): string {
  const delta = Math.max(0, nowMs - thenMs);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) {
    return sec <= 1 ? '刚刚' : `${sec} 秒前`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min} 分钟前`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr} 小时前`;
  }
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
