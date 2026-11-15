/**
 * Sync {@link PersistentState} project/session pointers with in-memory scope.
 *
 * @module runtime/mobile-scope
 */

import {Result, AppError} from '@novel-master/core/errors';
import type {MobileNovelMasterRuntime} from './types';

export interface MobileScopeSnapshot {
  projectId: string | undefined;
  sessionId: string | undefined;
}

/**
 * Loads persisted pointers and reconciles against project/session lists.
 * 失败通道（错误通道迁移四期）：持久层 `Result` 失败沿返回值接力，调用方
 * （novel-master-context bootstrap / refreshScope）失败走错误屏或静默保持。
 */
export async function loadMobileScope(
  runtime: MobileNovelMasterRuntime,
): Promise<Result<MobileScopeSnapshot, AppError>> {
  const currentProject = await runtime.state.getCurrentProjectId();
  if (!currentProject.ok) return Result.err(currentProject.error);
  let projectId = currentProject.value;
  const currentSession = await runtime.state.getCurrentSessionId();
  if (!currentSession.ok) return Result.err(currentSession.error);
  let sessionId = currentSession.value;

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
    return Result.ok({projectId: undefined, sessionId: undefined});
  }

  const sessions = await runtime.sessions.listByProject(projectId);
  if (!sessions.ok) return Result.err(sessions.error);
  if (sessionId != null && !sessions.value.some(s => s.id === sessionId)) {
    sessionId = undefined;
    await runtime.state.resetCurrentSessionId();
  }
  if (sessionId == null && sessions.value.length > 0) {
    const nextSessionId = sessions.value[0]!.id;
    sessionId = nextSessionId;
    await runtime.state.setCurrentSessionId(nextSessionId);
  }

  return Result.ok({projectId, sessionId});
}

/** Persists and returns updated project scope (clears session when project changes). */
export async function setMobileProject(
  runtime: MobileNovelMasterRuntime,
  projectId: string,
): Promise<Result<MobileScopeSnapshot, AppError>> {
  await runtime.state.setCurrentProjectId(projectId);
  const sessions = await runtime.sessions.listByProject(projectId);
  if (!sessions.ok) return Result.err(sessions.error);
  const sessionId = sessions.value[0]?.id;
  if (sessionId != null) {
    await runtime.state.setCurrentSessionId(sessionId);
  } else {
    await runtime.state.resetCurrentSessionId();
  }
  return Result.ok({projectId, sessionId});
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
