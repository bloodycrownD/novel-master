/**
 * Sync {@link PersistentState} project/session pointers via IPC.
 *
 * @module state/desktop-scope
 */
import {
  ipcScopeGet,
  ipcScopeSetProject,
  ipcScopeSetSession,
} from "../ipc/client";
import type { ScopeSnapshotDto } from "../../shared/ipc-types";

export type DesktopScopeSnapshot = ScopeSnapshotDto;

function unwrap<T>(result: { ok: boolean; data?: T; error?: { message: string } }): T {
  if (!result.ok) {
    throw new Error(result.error?.message ?? "IPC request failed");
  }
  return result.data as T;
}

/** Loads persisted pointers and reconciles against project/session lists. */
export async function loadDesktopScope(): Promise<DesktopScopeSnapshot> {
  return unwrap(await ipcScopeGet());
}

/** Persists project scope (clears or picks first session when project changes). */
export async function setDesktopProject(
  projectId: string,
): Promise<DesktopScopeSnapshot> {
  return unwrap(await ipcScopeSetProject({ projectId }));
}

/** Persists session pointer for the current project. */
export async function setDesktopSession(
  projectId: string,
  sessionId: string,
): Promise<DesktopScopeSnapshot> {
  return unwrap(await ipcScopeSetSession({ projectId, sessionId }));
}
