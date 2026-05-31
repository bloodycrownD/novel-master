/**
 * Workspace project/session scope synced with {@link PersistentState}.
 */
import {useNovelMaster} from '../runtime/novel-master-context';
import type {MobileScopeSnapshot} from '../runtime/mobile-scope';

export function useMobileScope(): MobileScopeSnapshot & {
  setCurrentProject: (projectId: string) => Promise<void>;
  setCurrentSession: (sessionId: string) => Promise<void>;
  refreshScope: () => Promise<void>;
} {
  const {scope, setCurrentProject, setCurrentSession, refreshScope} =
    useNovelMaster();
  return {
    ...scope,
    setCurrentProject,
    setCurrentSession,
    refreshScope,
  };
}
