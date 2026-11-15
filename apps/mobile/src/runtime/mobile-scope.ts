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
  * 解包 throw 边界（错误通道迁移三期门⑦）：runtime.sessions 的 `Result` 失败原样上抛（switchToProject 同款）——core Result → 端内异常通道转码边界，UI 调用链 catch → formatError → toast 收口。
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
    const nextProjectId = projects[0]!.id;
    projectId = nextProjectId;
    await runtime.state.setCurrentProjectId(nextProjectId);
  }

  if (projectId == null) {
    if (sessionId != null) {
      await runtime.state.resetCurrentSessionId();
    }
    return {projectId: undefined, sessionId: undefined};
  }

  const sessions = await runtime.sessions.listByProject(projectId);
  if (!sessions.ok) throw sessions.error;
  if (sessionId != null && !sessions.value.some(s => s.id === sessionId)) {
    sessionId = undefined;
    await runtime.state.resetCurrentSessionId();
  }
  if (sessionId == null && sessions.value.length > 0) {
    const nextSessionId = sessions.value[0]!.id;
    sessionId = nextSessionId;
    await runtime.state.setCurrentSessionId(nextSessionId);
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
  if (!sessions.ok) throw sessions.error;
  const sessionId = sessions.value[0]?.id;
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
