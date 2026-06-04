/**
 * React context: mobile runtime bootstrap, UI prefs, and workspace scope.
 *
 * @module runtime/novel-master-context
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {closeMobileConnection} from '../db/connection';
import {
  createAppUiPreferences,
  type AppUiPreferences,
} from '../storage/app-ui-prefs';
import {syncAppVersionForRichRender} from '../storage/app-version-guard';
import {createMobileNovelMasterRuntime} from './create-mobile-runtime';
import mobilePackage from '../../package.json';
import {
  loadMobileScope,
  setMobileProject,
  setMobileSession,
  type MobileScopeSnapshot,
} from './mobile-scope';
import type {MobileNovelMasterRuntime} from './types';

export type RuntimeStatus = 'loading' | 'ready' | 'error';

export interface NovelMasterContextValue {
  status: RuntimeStatus;
  runtime: MobileNovelMasterRuntime | undefined;
  appUi: AppUiPreferences | undefined;
  /** Rich-text remount generation; bumps when app package version changes. */
  richRenderEpoch: number;
  error: string | undefined;
  retry: () => void;
  scope: MobileScopeSnapshot;
  setCurrentProject: (projectId: string) => Promise<void>;
  setCurrentSession: (sessionId: string) => Promise<void>;
  refreshScope: () => Promise<void>;
}

const NovelMasterContext = createContext<NovelMasterContextValue | undefined>(
  undefined,
);

function formatBootstrapError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function NovelMasterProvider({children}: {children: ReactNode}) {
  const [status, setStatus] = useState<RuntimeStatus>('loading');
  const [runtime, setRuntime] = useState<MobileNovelMasterRuntime | undefined>();
  const [appUi, setAppUi] = useState<AppUiPreferences | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [scope, setScope] = useState<MobileScopeSnapshot>({
    projectId: undefined,
    sessionId: undefined,
  });
  const [richRenderEpoch, setRichRenderEpoch] = useState(0);
  const [bootToken, setBootToken] = useState(0);

  const retry = useCallback(() => {
    setBootToken(t => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(undefined);

    (async () => {
      if (bootToken > 0) {
        await closeMobileConnection();
      }
      const rt = await createMobileNovelMasterRuntime();
      const loaded = await loadMobileScope(rt);
      const ui = createAppUiPreferences(rt.kkv);
      const epoch = await syncAppVersionForRichRender(
        ui,
        mobilePackage.version,
      );
      if (cancelled) {
        return;
      }
      setRuntime(rt);
      setAppUi(ui);
      setRichRenderEpoch(epoch);
      setScope(loaded);
      setStatus('ready');
    })()
      .catch(err => {
        if (!cancelled) {
          setRuntime(undefined);
          setAppUi(undefined);
          setError(formatBootstrapError(err));
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootToken]);

  const refreshScope = useCallback(async () => {
    if (!runtime) {
      return;
    }
    const loaded = await loadMobileScope(runtime);
    setScope(loaded);
  }, [runtime]);

  const setCurrentProject = useCallback(
    async (projectId: string) => {
      if (!runtime) {
        return;
      }
      const next = await setMobileProject(runtime, projectId);
      setScope(next);
    },
    [runtime],
  );

  const setCurrentSession = useCallback(
    async (sessionId: string) => {
      if (!runtime || scope.projectId == null) {
        return;
      }
      const next = await setMobileSession(runtime, scope.projectId, sessionId);
      setScope(next);
    },
    [runtime, scope.projectId],
  );

  const value = useMemo<NovelMasterContextValue>(
    () => ({
      status,
      runtime,
      appUi,
      richRenderEpoch,
      error,
      retry,
      scope,
      setCurrentProject,
      setCurrentSession,
      refreshScope,
    }),
    [
      status,
      runtime,
      appUi,
      richRenderEpoch,
      error,
      retry,
      scope,
      setCurrentProject,
      setCurrentSession,
      refreshScope,
    ],
  );

  if (status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>正在加载…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>启动失败</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <Button title="重试" onPress={retry} />
      </View>
    );
  }

  return (
    <NovelMasterContext.Provider value={value}>
      {children}
    </NovelMasterContext.Provider>
  );
}

export function useNovelMaster(): NovelMasterContextValue {
  const ctx = useContext(NovelMasterContext);
  if (!ctx) {
    throw new Error('useNovelMaster must be used within NovelMasterProvider');
  }
  return ctx;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  loadingText: {marginTop: 8, fontSize: 16},
  errorTitle: {fontSize: 18, fontWeight: '600'},
  errorMessage: {fontSize: 14, textAlign: 'center', color: '#666'},
});
