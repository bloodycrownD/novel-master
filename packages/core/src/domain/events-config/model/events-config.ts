/**
 * Events configuration document (user YAML → domain).
 *
 * @module domain/events-config/model/events-config
 */

import type { DepthSlice } from "@/domain/depth/logic/depth-slice.js";

export type EventActionType = "hide-message" | "refresh-macros" | "agent-run";

export interface HideMessageActionParams extends DepthSlice {}

export interface EventAction {
  readonly type: EventActionType;
  readonly params: HideMessageActionParams | Record<string, never>;
}

export type EventExecutionMode =
  | { readonly mode: "sequential"; readonly actions: readonly EventAction[] }
  | { readonly mode: "parallel"; readonly actions: readonly EventAction[] };

export interface EventsConfig {
  readonly schemaVersion: number;
  readonly events: Readonly<Record<string, EventExecutionMode>>;
}
