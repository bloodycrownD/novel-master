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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  useColorScheme,
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
import {SessionStreamUnitManager} from '@/services/session-stream-unit-manager.service';
import {createSessionRunStateService} from '@novel-master/core/session-run-state';
import {showAppToast} from '@/services/app-toast';
import {readAgentFinishedNotificationEnabled} from '@/storage/agent-finished-notification-pref';
import {readAgentKeepAliveEnabled} from '@/storage/agent-keepalive-pref';
import {tokensForMode} from '../theme/tokens';

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
  // 本组件在 ThemeProvider 之外渲染，直接按系统色取 token（错误屏要适配 dark）。
  const colorScheme = useColorScheme();
  const [status, setStatus] = useState<RuntimeStatus>('loading');
  const [runtime, setRuntime] = useState<
    MobileNovelMasterRuntime | undefined
  >();
  const [appUi, setAppUi] = useState<AppUiPreferences | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [scope, setScope] = useState<MobileScopeSnapshot>({
    projectId: undefined,
    sessionId: undefined,
  });
  const [richRenderEpoch, setRichRenderEpoch] = useState(0);
  const [bootToken, setBootToken] = useState(0);
  // 当前 runtime / appUi / scope 的同步镜像——桥闭包（React 外）读最新值用。
  const runtimeRef = useRef<MobileNovelMasterRuntime | undefined>(undefined);
  const appUiRef = useRef<AppUiPreferences | undefined>(undefined);
  const scopeRef = useRef<MobileScopeSnapshot>(scope);
  runtimeRef.current = runtime;
  appUiRef.current = appUi;
  scopeRef.current = scope;

  const retry = useCallback(() => {
    setBootToken(t => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(undefined);

    (async () => {
      if (bootToken > 0) {
        // 对齐 desktop main 的先 detach 模式：重建前先销毁旧 Manager
        // （退订事件总线 + 按记录清零模块级 refcount + 停前台服务 + 在途
        // 写通尽力落盘），再销毁旧连接。模块级 agent-activity 不随 runtime
        // 重建归零，必须 dispose 显式清零。
        runtimeRef.current?.sessionStreamUnitManager.dispose();
        await closeMobileConnection();
      }
      const rt = await createMobileNovelMasterRuntime();
      // 装配契约：runtime 创建完成后实例化 Manager 并挂到 runtime 上
      // （Manager 生命周期跟随 runtime；桥在下方 ready 后的 effect 注入）。
      // 构造注入 core 的 session_run_state 服务——持久化开跑（写通/水合/
      // settled 投影），注入即自动 kick 重启水合。
      const runtime: MobileNovelMasterRuntime = Object.assign(rt, {
        sessionStreamUnitManager: new SessionStreamUnitManager({
          runtime: rt,
          runStateService: createSessionRunStateService(rt.conn),
        }),
      });
      const loaded = await loadMobileScope(runtime);
      const ui = createAppUiPreferences(runtime.kkv);
      const epoch = await syncAppVersionForRichRender(
        ui,
        mobilePackage.version,
      );
      if (cancelled) {
        return;
      }
      setRuntime(runtime);
      setAppUi(ui);
      setRichRenderEpoch(epoch);
      setScope(loaded);
      setStatus('ready');
    })().catch(err => {
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

  // 桥注入（ready 后执行；retry 换新 runtime 时对新 Manager 重新注入）。
  // 桥未注入期间（bootstrap 早期与 retry 窗口）的降级：失败 toast 与完成通知
  // 不发，refcount 与单元维护不依赖桥，始终生效。
  useEffect(() => {
    const manager = runtime?.sessionStreamUnitManager;
    if (!manager) {
      return;
    }
    manager.setUiBridge({onError: message => showAppToast(message)});
    manager.setPrefBridge({
      isEnabled: () => {
        const appUiNow = appUiRef.current;
        if (appUiNow == null) {
          return Promise.resolve(true);
        }
        return readAgentFinishedNotificationEnabled(appUiNow);
      },
      isKeepAliveEnabled: () => {
        const appUiNow = appUiRef.current;
        if (appUiNow == null) {
          return Promise.resolve(false);
        }
        return readAgentKeepAliveEnabled(appUiNow);
      },
    });
    manager.setScopeBridge({
      getCurrentSessionId: () => scopeRef.current.sessionId ?? null,
      setCurrentSession: async sessionId => {
        const rt = runtimeRef.current;
        const projectId = scopeRef.current.projectId;
        if (!rt || projectId == null) {
          return;
        }
        // 通知点按路径的 scope 同步：持久化 + 直接 setScope 更新 React state
        // （不在 React 外裸调模块级 setMobileSession——它只写持久层不更新 React scope）。
        const next = await setMobileSession(rt, projectId, sessionId);
        setScope(next);
      },
    });
  }, [runtime]);

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
    const errorMessageColor = tokensForMode(
      colorScheme === 'dark' ? 'dark' : 'light',
    ).textSecondary;
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>启动失败</Text>
        <Text style={[styles.errorMessage, {color: errorMessageColor}]}>
          {error}
        </Text>
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
  errorMessage: {fontSize: 14, textAlign: 'center'},
});
