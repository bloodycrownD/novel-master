/**
 * Invalidate session worktree snapshot after agent VFS tool rounds.
 */
import { EVENT_AGENT_RUN_FINISHED, EVENT_AGENT_STEP_COMMITTED, type AgentRunFinishedPayload, type AgentStepCommittedPayload, type SimpleEventBus } from "@novel-master/core/events";
import { invalidateSessionWorktreeSnapshot } from "./ipc/resolve-vfs-scope.js";
import { getDesktopRuntime } from "./runtime/desktop-runtime-singleton.js";

async function invalidateSessionWorktree(
  projectId: string,
  sessionId: string,
): Promise<void> {
  const rt = await getDesktopRuntime();
  invalidateSessionWorktreeSnapshot(rt, {
    kind: "session",
    projectId,
    sessionId,
  });
}

/** Clears stale session worktree snapshot when agent tools mutate chat VFS. */
export function attachSessionWorktreeSync(eventBus: SimpleEventBus): () => void {
  const subs = [
    eventBus.subscribe(
      EVENT_AGENT_STEP_COMMITTED,
      (payload: AgentStepCommittedPayload) => {
        if (payload.phase !== "tool_results" || payload.vfsMutated !== true) {
          return;
        }
        void invalidateSessionWorktree(payload.projectId, payload.sessionId);
      },
    ),
    eventBus.subscribe(
      EVENT_AGENT_RUN_FINISHED,
      (payload: AgentRunFinishedPayload) => {
        if (payload.vfsMutated !== true) {
          return;
        }
        void invalidateSessionWorktree(payload.projectId, payload.sessionId);
      },
    ),
  ];
  return () => {
    for (const sub of subs) {
      sub.unsubscribe();
    }
  };
}
