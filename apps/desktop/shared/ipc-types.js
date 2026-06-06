/**
 * IPC channel names and serializable DTOs shared by main, preload, and renderer.
 * Single source of truth — handlers must not invent ad-hoc channel strings.
 */
export const IPC_CHANNELS = {
    BOOTSTRAP_STATUS: "nm:bootstrap/status",
    BOOTSTRAP_REBOOTSTRAP: "nm:bootstrap/rebootstrap",
    EVENT_BUS: "nm:event-bus",
    AGENT_STREAM: "nm:agent-stream",
};
//# sourceMappingURL=ipc-types.js.map