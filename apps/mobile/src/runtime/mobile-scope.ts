/**
 * Sync {@link PersistentState} project/session pointers with in-memory scope.
 *
 * @module runtime/mobile-scope
 */

import type {MobileNovelMasterRuntime} from './types';

export interface MobileScopeSnapshot {
  projectId: string | undefined;
  sessionId: string | undefined;
}

/**
 * Loads persisted pointers and reconciles against project/session lists.
 */
export async function loadMobileScope(
  runtime: MobileNovelMasterRuntime,
): Promise<MobileScopeSnapshot> {
  let projectId = await runtime.state.getCurrentProjectId();
  let sessionId = await runtime.state.getCurrentSessionId();

  const projects = await runtime.projects.list();
  if (projectId != null && !projects.some(p => p.id === projectId)) {
    projectId = undefined;
    await runtime.state.resetCurrentProjectId();
  }
  if (projectId == null && projects.length > 0) {
    projectId = projects[0]!.id;
    await runtime.state.setCurrentProjectId(projectId);
  }

  if (projectId == null) {
    if (sessionId != null) {
      await runtime.state.resetCurrentSessionId();
    }
    return {projectId: undefined, sessionId: undefined};
  }

  const sessions = await runtime.sessions.listByProject(projectId);
  if (sessionId != null && !sessions.some(s => s.id === sessionId)) {
    sessionId = undefined;
    await runtime.state.resetCurrentSessionId();
  }
  if (sessionId == null && sessions.length > 0) {
    sessionId = sessions[0]!.id;
    await runtime.state.setCurrentSessionId(sessionId);
  }

  return {projectId, sessionId};
}

/** Persists and returns updated project scope (clears session when project changes). */
export async function setMobileProject(
  runtime: MobileNovelMasterRuntime,
  projectId: string,
): Promise<MobileScopeSnapshot> {
  await runtime.state.setCurrentProjectId(projectId);
  const sessions = await runtime.sessions.listByProject(projectId);
  const sessionId = sessions[0]?.id;
  if (sessionId != null) {
    await runtime.state.setCurrentSessionId(sessionId);
  } else {
    await runtime.state.resetCurrentSessionId();
  }
  return {projectId, sessionId};
}

/** Persists session pointer for the current project. */
export async function setMobileSession(
  runtime: MobileNovelMasterRuntime,
  projectId: string,
  sessionId: string,
): Promise<MobileScopeSnapshot> {
  await runtime.state.setCurrentProjectId(projectId);
  await runtime.state.setCurrentSessionId(sessionId);
  return {projectId, sessionId};
}
