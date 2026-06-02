/**
 * Save-time validation for events config UI drafts.
 */
import {validateDepthSlice} from '@novel-master/core';
import type {EventBlockDraft} from './event-config-state';
import {actionTypeLabel, eventTypeLabel} from './event-config-labels';

export function validateEventConfigBlocks(
  blocks: readonly EventBlockDraft[],
): string | null {
  if (blocks.length === 0) {
    return '至少添加一个事件';
  }
  const seenEvents = new Set<string>();
  for (const block of blocks) {
    const key = block.eventType.trim();
    const eventLabel = eventTypeLabel(key);
    if (key === '') {
      return '请为每个事件选择类型';
    }
    if (seenEvents.has(key)) {
      return `事件「${eventLabel}」重复，请删除多余项后再保存`;
    }
    seenEvents.add(key);

    if (block.chain.actions.length === 0) {
      return `「${eventLabel}」至少需要一个动作`;
    }

    const seenActions = new Set<string>();
    for (const action of block.chain.actions) {
      if (seenActions.has(action.type)) {
        return `「${eventLabel}」中动作「${actionTypeLabel(action.type)}」重复，请删除多余项后再保存`;
      }
      seenActions.add(action.type);

      if (action.type === 'run-agent') {
        const agentId =
          'agentId' in action.params ? String(action.params.agentId).trim() : '';
        if (agentId === '') {
          return `「${eventLabel}」· 运行 Agent：请填写 agentId`;
        }
        continue;
      }

      if (action.type !== 'hide-message') {
        continue;
      }
      try {
        validateDepthSlice({
          startDepth: action.params.startDepth ?? undefined,
          endDepth: action.params.endDepth ?? undefined,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return `「${eventLabel}」· 隐藏消息：${msg}`;
      }
    }
  }
  return null;
}
