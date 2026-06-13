/**
 * Save-time validation for events config UI drafts.
 */
import { validateDepthSlice } from "../shared/depth-slice.js";
import type { EventBlockDraft } from "./event-config-state.js";
import { isUnknownActionDraft } from "./event-config-editor-load.js";
import { actionTypeLabel, eventTypeLabel } from "./event-config-labels.js";

function validateDag(
  actions: readonly { type: string; dependency?: readonly string[] }[],
): string | null {
  const seen = new Set<string>();
  for (const a of actions) {
    if (seen.has(a.type)) {
      return `动作「${a.type}」重复`;
    }
    seen.add(a.type);
  }
  for (const a of actions) {
    for (const dep of a.dependency ?? []) {
      if (!seen.has(dep)) {
        return `动作「${a.type}」依赖不存在：${dep}`;
      }
      if (dep === a.type) {
        return `动作「${a.type}」不能依赖自身`;
      }
    }
  }

  const indegree = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const a of actions) {
    indegree.set(a.type, 0);
    out.set(a.type, []);
  }
  for (const a of actions) {
    for (const dep of a.dependency ?? []) {
      out.get(dep)!.push(a.type);
      indegree.set(a.type, (indegree.get(a.type) ?? 0) + 1);
    }
  }
  const q: string[] = [];
  for (const [t, d] of indegree.entries()) {
    if (d === 0) q.push(t);
  }
  let visited = 0;
  while (q.length > 0) {
    const t = q.shift()!;
    visited++;
    for (const nxt of out.get(t) ?? []) {
      const v = (indegree.get(nxt) ?? 0) - 1;
      indegree.set(nxt, v);
      if (v === 0) q.push(nxt);
    }
  }
  if (visited !== actions.length) {
    return "依赖存在循环（DAG 必须无环）";
  }
  return null;
}

export function validateEventConfigBlocks(
  blocks: readonly EventBlockDraft[],
): string | null {
  if (blocks.length === 0) {
    return "至少添加一个事件";
  }
  const seenEvents = new Set<string>();
  for (const block of blocks) {
    const key = block.eventType.trim();
    const eventLabel = eventTypeLabel(key);
    if (key === "") {
      return "请为每个事件选择类型";
    }
    if (seenEvents.has(key)) {
      return `事件「${eventLabel}」重复，请删除多余项后再保存`;
    }
    seenEvents.add(key);

    if (block.actions.length === 0) {
      return `「${eventLabel}」至少需要一个动作`;
    }

    const seenActions = new Set<string>();
    for (const action of block.actions) {
      if (isUnknownActionDraft(action)) {
        return "存在未知 action，请移除后保存";
      }

      if (seenActions.has(action.type)) {
        return `「${eventLabel}」中动作「${actionTypeLabel(action.type)}」重复，请删除多余项后再保存`;
      }
      seenActions.add(action.type);

      if (action.type === "run-agent") {
        const agentId =
          "agentId" in action.params ? String(action.params.agentId).trim() : "";
        if (agentId === "") {
          return `「${eventLabel}」· 运行 Agent：请填写 agentId`;
        }
        continue;
      }

      if (action.type !== "hide-message") {
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

    const dagErr = validateDag(block.actions);
    if (dagErr != null) {
      return `「${eventLabel}」· ${dagErr}`;
    }
  }
  return null;
}
