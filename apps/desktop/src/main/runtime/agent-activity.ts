/** Tracks whether an agent run is in progress (blocks backup/import). */
let agentActive = false;

export function isDesktopAgentActive(): boolean {
  return agentActive;
}

export function setDesktopAgentActive(active: boolean): void {
  agentActive = active;
}
