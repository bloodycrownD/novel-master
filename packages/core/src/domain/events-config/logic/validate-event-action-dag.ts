/**
 * 校验单个 event 内 action 类型 DAG（重复类型、依赖、无环）。
 * @module domain/events-config/logic/validate-event-action-dag
 */

/** 供 schema / UI / orchestrator 适配的机器可读失败码。 */
export type EventActionDagFailureCode =
  | "duplicate_action_type"
  | "unknown_dependency"
  | "self_dependency"
  | "cycle";

export class EventActionDagError extends Error {
  readonly code: EventActionDagFailureCode;
  readonly actionType?: string;
  readonly dependency?: string;

  constructor(
    code: EventActionDagFailureCode,
    message: string,
    meta?: { actionType?: string; dependency?: string },
  ) {
    super(message);
    this.name = "EventActionDagError";
    this.code = code;
    this.actionType = meta?.actionType;
    this.dependency = meta?.dependency;
  }
}

export type EventActionDagNode = {
  readonly type: string;
  readonly dependency?: readonly string[];
};

/** 违反规则时抛出 EventActionDagError。 */
export function validateEventActionDag(nodes: readonly EventActionDagNode[]): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.type)) {
      throw new EventActionDagError(
        "duplicate_action_type",
        `duplicate action type in one event: ${node.type}`,
        { actionType: node.type },
      );
    }
    seen.add(node.type);
  }

  for (const node of nodes) {
    for (const dep of node.dependency ?? []) {
      if (!seen.has(dep)) {
        throw new EventActionDagError(
          "unknown_dependency",
          `unknown dependency reference: ${node.type} depends on ${dep}`,
          { actionType: node.type, dependency: dep },
        );
      }
      if (dep === node.type) {
        throw new EventActionDagError(
          "self_dependency",
          `action cannot depend on itself: ${node.type}`,
          { actionType: node.type },
        );
      }
    }
  }

  const indegree = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.type, 0);
    out.set(node.type, []);
  }
  for (const node of nodes) {
    for (const dep of node.dependency ?? []) {
      out.get(dep)!.push(node.type);
      indegree.set(node.type, (indegree.get(node.type) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [t, deg] of indegree.entries()) {
    if (deg === 0) queue.push(t);
  }
  let visited = 0;
  while (queue.length > 0) {
    const t = queue.shift()!;
    visited++;
    for (const nxt of out.get(t) ?? []) {
      const v = (indegree.get(nxt) ?? 0) - 1;
      indegree.set(nxt, v);
      if (v === 0) queue.push(nxt);
    }
  }
  if (visited !== nodes.length) {
    throw new EventActionDagError("cycle", "dependency graph has a cycle");
  }
}
