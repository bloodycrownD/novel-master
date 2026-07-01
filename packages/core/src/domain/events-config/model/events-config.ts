/**
 * Events configuration document (user YAML → domain).
 *
 * @module domain/events-config/model/events-config
 */

import type { DepthSlice } from "@/domain/depth/logic/depth-slice.js";

export type EventActionType = "hide-message" | "run-agent";

export type HideMessageActionParams = DepthSlice;

export interface RunAgentActionParams {
  readonly agentId: string;
}

export type EventAction =
  | { readonly type: "hide-message"; readonly params: HideMessageActionParams }
  | { readonly type: "run-agent"; readonly params: RunAgentActionParams };

export type EventActionNode = EventAction & {
  /**
   * The action types that must complete successfully before this action can run.
   * References are by action type (unique per event).
   */
  readonly dependency?: readonly EventActionType[];
};

export interface EventsConfig {
  readonly schemaVersion: 2;
  readonly events: Readonly<Record<string, readonly EventActionNode[]>>;
}
