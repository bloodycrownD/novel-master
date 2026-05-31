/**
 * Session log data load and checkpoint rollback.
 */
import type {
  ChatMessage,
  SessionFsBatchSummary,
} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {
  buildTimeline,
  type BuildTimelineOptions,
  type TimelineItem,
} from '../components/session-log/timeline-builder';

export interface SessionLogSnapshot {
  readonly messages: readonly ChatMessage[];
  readonly batches: readonly SessionFsBatchSummary[];
  readonly timeline: readonly TimelineItem[];
}

export async function loadSessionLog(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  timelineOptions: BuildTimelineOptions,
): Promise<SessionLogSnapshot> {
  const all = await runtime.messages.listBySession(sessionId);
  const messages = all.filter((m: ChatMessage) => !m.hidden);
  const batches = await runtime.sessionFs.listBatches(sessionId);
  const timeline = buildTimeline(messages, batches, timelineOptions);
  return {messages, batches, timeline};
}

export async function rollbackSessionBatch(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  projectId: string,
  batchId: string,
): Promise<void> {
  await runtime.sessionFs.rollbackBatch(sessionId, projectId, batchId);
}
