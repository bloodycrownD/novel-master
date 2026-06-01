/**
 * Zod schemas for events config wire documents.
 *
 * @module domain/events-config/model/events-config.schema
 */

import { z } from "zod";
import type { EventAction, EventsConfig, EventExecutionMode } from "./events-config.js";
import { depthSliceFromWire } from "@/domain/depth/logic/depth-slice.js";
import { validateDepthSlice } from "@/domain/depth/logic/depth-slice.js";

const depthWireSchema = z
  .object({
    startDepth: z.number().int().nonnegative().optional(),
    endDepth: z.number().int().nonnegative().optional(),
    "start-depth": z.number().int().nonnegative().optional(),
    "end-depth": z.number().int().nonnegative().optional(),
  })
  .strict();

function parseActionItem(raw: unknown): EventAction {
  if (typeof raw === "string") {
    if (raw === "refresh-macros") {
      return { type: "refresh-macros", params: {} };
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
    return { type: "refresh-macros", params: {} };
  }
  if (type === "hide-message") {
    const paramsRaw = obj[type];
    const wire =
      paramsRaw != null && typeof paramsRaw === "object"
        ? (paramsRaw as Record<string, unknown>)
        : {};
    const slice = depthSliceFromWire(wire);
    validateDepthSlice(slice);
    return { type: "hide-message", params: slice };
  }
  if (type === "agent-run") {
    return { type: "agent-run", params: {} };
  }
  throw new Error(`unknown action type: ${type}`);
}

const executionModeSchema = z.union([
  z
    .object({
      sequential: z.array(z.unknown()).min(1),
    })
    .strict()
    .transform((v): EventExecutionMode => ({
      mode: "sequential",
      actions: v.sequential.map(parseActionItem),
    })),
  z
    .object({
      parallel: z.array(z.unknown()).min(1),
    })
    .strict()
    .transform((v): EventExecutionMode => ({
      mode: "parallel",
      actions: v.parallel.map(parseActionItem),
    })),
]);

const eventsConfigDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    events: z.record(z.string(), executionModeSchema),
  })
  .strict();

/** Wire document → {@link EventsConfig}. */
export const eventsConfigSchema = eventsConfigDocumentSchema.transform(
  (doc): EventsConfig => ({
    schemaVersion: doc.schemaVersion,
    events: doc.events,
  }),
);

export { depthWireSchema };
