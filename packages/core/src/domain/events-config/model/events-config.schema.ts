/**
 * Zod schemas for events config wire documents.
 *
 * @module domain/events-config/model/events-config.schema
 */

import { z } from "zod";
import type { EventActionNode, EventActionType, EventsConfig } from "./events-config.js";
import type { DepthSlice } from "@/domain/depth/logic/depth-slice.js";
import { depthSliceFromWire } from "@/domain/depth/logic/depth-slice.js";
import { validateDepthSlice } from "@/domain/depth/logic/depth-slice.js";
import { validateEventActionDag } from "../logic/validate-event-action-dag.js";

const depthWireSchema = z
  .object({
    startDepth: z.number().int().nonnegative().optional(),
    endDepth: z.number().int().nonnegative().optional(),
    "start-depth": z.number().int().nonnegative().optional(),
    "end-depth": z.number().int().nonnegative().optional(),
  })
  .strict();

type EventsConfigWireDocument = {
  readonly schemaVersion: 2;
  readonly events: Record<string, readonly unknown[]>;
};

function cleanDepthSlice(slice: DepthSlice): DepthSlice {
  return {
    ...(slice.startDepth != null ? { startDepth: slice.startDepth } : {}),
    ...(slice.endDepth != null ? { endDepth: slice.endDepth } : {}),
  };
}

function withDependency<T extends EventActionNode>(
  node: Omit<T, "dependency">,
  dependency: readonly EventActionType[] | undefined,
): T {
  if (dependency == null) {
    return node as T;
  }
  return { ...node, dependency } as T;
}

function parseDependency(wire: Record<string, unknown>): readonly EventActionType[] | undefined {
  const depRaw = wire.dependency;
  if (depRaw == null) {
    return undefined;
  }
  if (!Array.isArray(depRaw)) {
    throw new Error("dependency must be an array");
  }
  const deps = depRaw.map((v) => String(v).trim()).filter((v) => v !== "");
  if (deps.length === 0) {
    return undefined;
  }
  return deps as readonly EventActionType[];
}

function actionNodeToWire(node: EventActionNode): unknown {
  const wire: Record<string, unknown> = {};
  if (node.dependency != null && node.dependency.length > 0) {
    wire.dependency = [...node.dependency];
  }

  if (node.type === "hide-message") {
    if (node.params.startDepth != null) {
      wire["start-depth"] = node.params.startDepth;
    }
    if (node.params.endDepth != null) {
      wire["end-depth"] = node.params.endDepth;
    }
    return { "hide-message": wire };
  }

  if (node.type === "run-agent") {
    return {
      "run-agent": {
        "agent-id": node.params.agentId,
        ...wire,
      },
    };
  }

  throw new Error(`unknown action type: ${(node as EventActionNode).type}`);
}

function eventsConfigToWire(config: EventsConfig): EventsConfigWireDocument {
  const events: Record<string, readonly unknown[]> = {};
  for (const [eventName, nodes] of Object.entries(config.events)) {
    events[eventName] = nodes.map(actionNodeToWire);
  }
  return {
    schemaVersion: config.schemaVersion,
    events,
  };
}

function parseActionNode(raw: unknown): EventActionNode {
  if (typeof raw === "string") {
    if (raw === "refresh-macros") {
      throw new Error("refresh-macros action is removed");
    }
    throw new Error(`unknown action shorthand: ${raw}`);
  }
  if (raw == null || typeof raw !== "object") {
    throw new Error("invalid action item");
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    throw new Error("action item must have exactly one key");
  }
  const type = keys[0]!;
  if (type === "refresh-macros") {
    throw new Error("refresh-macros action is removed");
  }
  if (type === "hide-message") {
    const paramsRaw = obj[type];
    const wire =
      paramsRaw != null && typeof paramsRaw === "object"
        ? (paramsRaw as Record<string, unknown>)
        : {};
    const dependency = parseDependency(wire);
    const slice = depthSliceFromWire(wire);
    validateDepthSlice(slice);
    return withDependency(
      { type: "hide-message", params: cleanDepthSlice(slice) },
      dependency,
    );
  }
  if (type === "agent-run") {
    throw new Error("action 'agent-run' was renamed to 'run-agent'");
  }
  if (type === "run-agent") {
    const paramsRaw = obj[type];
    const wire =
      paramsRaw != null && typeof paramsRaw === "object"
        ? (paramsRaw as Record<string, unknown>)
        : {};
    const dependency = parseDependency(wire);
    const agentId = String(wire.agentId ?? wire["agent-id"] ?? "").trim();
    if (agentId === "") {
      throw new Error("run-agent requires agentId");
    }
    return withDependency({ type: "run-agent", params: { agentId } }, dependency);
  }
  throw new Error(`unknown action type: ${type}`);
}

const eventNodesSchema = z
  .array(z.unknown())
  .min(1)
  .transform((items): readonly EventActionNode[] => items.map(parseActionNode))
  .superRefine((nodes, ctx) => {
    try {
      validateEventActionDag(nodes);
    } catch (e: unknown) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

const eventsConfigDocumentSchema = z
  .object({
    schemaVersion: z.literal(2),
    events: z.record(z.string(), eventNodesSchema),
  })
  .strict();

/** Wire document ↔ {@link EventsConfig}. */
export const eventsConfigSchema = Object.assign(
  eventsConfigDocumentSchema.transform(
    (doc): EventsConfig => ({
      schemaVersion: doc.schemaVersion,
      events: doc.events,
    }),
  ),
  { toWire: eventsConfigToWire },
);

export { depthWireSchema, parseActionNode };
