/**
 * Process-wide agent run flag for operations that must not run during a turn.
 */

let agentActive = false;

/** Set while an agent turn is in progress (chat composer). */
export function setMobileAgentActive(active: boolean): void {
  agentActive = active;
}

/** True when chat agent is running; used by DB backup guard. */
export function isMobileAgentActive(): boolean {
  return agentActive;
}
