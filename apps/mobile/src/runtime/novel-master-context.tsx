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
import {
  armRebootWaiter,
  rebindRebootWaiterGeneration,
  settleRebootWaiter,
  type RebootWaiter,
} from './reboot-waiter';
import {
  SessionStreamUnitManager,
  type SessionStreamPrefBridge,
} from '@/services/session-stream-unit-manager.service';
import {createSessionRunStateService} from '@novel-master/core/session-run-state';
import {
  createSessionStreamTokenEstimator,
  primeStreamTokenModelHint,
} from '@/services/stream-token-estimator';
import {showAppToast} from '@/services/app-toast';
import {setKeepAliveResidentEnabled} from '@/services/agent-finished-notification';
import {scheduleMobileBlobBinaryNormalization} from '@/services/blob-binary-normalization.service';
import {scheduleMobileMessageContentDecompress} from '@/services/message-content-decompression.service';
import {readMessageNotificationEnabled} from '@/storage/message-notification-pref';
import {tokensForMode} from '../theme/tokens';

export type RuntimeStatus = 'loading' | 'ready' | 'error';

/**
 * {@link NovelMasterContextValue.retryAndWait} 的悬空兜底超时。
 * 远大于正常重建耗时——只兜「effect 没能兑现 promise」这种异常路径，
 * 目的是让调用方永不永挂（永挂会让云同步 pull 的 busy 令牌永不 release）。
 */
const REBOOT_WAIT_TIMEOUT_MS = 60_000;

export interface NovelMasterContextValue {
  status: RuntimeStatus;
  runtime: MobileNovelMasterRuntime | undefined;
  appUi: AppUiPreferences | undefined;
  /** Rich-text remount generation; bumps when app package version changes. */
  richRenderEpoch: number;
  error: string | undefined;
  retry: () => void;
  /**
   * 可等待的重建：resolve 出重建完成后的**新 runtime**。
   *
   * 与 {@link retry} 的区别：retry 只是 `setBootToken(t => t + 1)`，真正的
   * runtime 重建发生在随后的 useEffect 里，调用方在 `retry()` 之后**同步拿不到
   * 新 runtime**。云同步 pull 换库之后必须用新 runtime 记账（旧的已关连接），
   * 所以给它这个可等待形态。
   */
  retryAndWait: () => Promise<MobileNovelMasterRuntime>;
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

/**
 * 常驻保活启动挂点：按消息通知开关拉起常驻前台服务通知。
 *
 * 直读 storage 层 readMessageNotificationEnabled（不走 prefBridge，避免
 * appUi 未就绪降级口径干扰），开则 setKeepAliveResidentEnabled(true)。
 * 签名显式接受 undefined：appUiRef.current 的声明类型就是
 * `AppUiPreferences | undefined`，而 readMessageNotificationEnabled 参数
 * 非空——守卫收在函数体内（typecheck 强制；时序上 effect 触发时 appUi
 * 必已就绪，守卫非时序需要）。拉起失败只 console.error，不向上抛
 * （fire-and-forget，与桥装配风格一致）。
 */
export async function ensureKeepAliveResidentBoot(
  appUi: AppUiPreferences | undefined,
): Promise<void> {
  if (appUi == null) {
    return;
  }
  if (!(await readMessageNotificationEnabled(appUi))) {
    return;
  }
  try {
    await setKeepAliveResidentEnabled(true);
  } catch (err) {
    console.error('keepalive: resident boot failed', err);
  }
}

/**
 * 消息通知偏好桥工厂：返回 manager 侧 isNotificationEnabled 的装配。
 *
 * appUi 未就绪（getAppUi() 返回 null）的降级口径取「关」——与开关默认关
 * 对齐，防装配早期误判开；appUi 就绪后按存储真值。
 */
export function createNotificationPrefBridge(
  getAppUi: () => AppUiPreferences | undefined,
): SessionStreamPrefBridge {
  return {
    isNotificationEnabled: () => {
      const appUiNow = getAppUi();
      if (appUiNow == null) {
        return Promise.resolve(false);
      }
      return readMessageNotificationEnabled(appUiNow);
    },
  };
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
  // bootToken 的同步镜像：retryAndWait 必须在登记 waiter 的同一拍就知道
  // 「下一代」代号是多少（useState 的函数式更新拿不到新值），否则 waiter
  // 登记的代号会停在上一代，等于没有归属判定。
  const bootTokenRef = useRef(0);
  // 当前 runtime / appUi / scope 的同步镜像——桥闭包（React 外）读最新值用。
  const runtimeRef = useRef<MobileNovelMasterRuntime | undefined>(undefined);
  const appUiRef = useRef<AppUiPreferences | undefined>(undefined);
  const scopeRef = useRef<MobileScopeSnapshot>(scope);
  runtimeRef.current = runtime;
  appUiRef.current = appUi;
  scopeRef.current = scope;

  const retry = useCallback(() => {
    const nextGeneration = bootTokenRef.current + 1;
    // 无参 retry 只推进代号、不新增等待方。若此时槽里正挂着等待方，必须把
    // 它的归属改绑到新代号——否则新一代 effect 兑现时会因代号不符而 no-op，
    // 等待方只能悬到 60s 超时（这是本修复会新引入的丢事件，务必堵死）。
    rebindRebootWaiterGeneration(rebootWaiterRef, nextGeneration);
    bootTokenRef.current = nextGeneration;
    setBootToken(nextGeneration);
  }, []);

  // 可等待重建的挂起槽：retryAndWait 把自己挂上来，由下面的 boot effect 在
  // setRuntime 之后兑现。cancelled 分支也必须 reject——漏掉会让调用方永挂在
  // await 上，外层 busy 令牌永不 release ⇒ 消息正文解压 / blob 归一两个后台
  // 循环全进程停摆。
  //
  // 归属判定（cr1-cloudsync P1-2）：槽内 waiter 带 bootToken 代号，兑现必须
  // 代际一致。原先这里是「单个全局槽 + 无归属」，已被 cleanup 标记 cancelled
  // 的**旧** effect 在 cancelled 收尾处或 .catch 里 reject 时，读到的是
  // **新一代**的 waiter ⇒ 重建明明成功，调用方却收到失败（云同步报「拉取
  // 失败」、lastSyncedRev 不推进）。规则真源见 ./reboot-waiter 纯函数模块。
  // 注意这里直接用 useRef<Waiter | null>(null)：`RefObject` 自身就满足
  // RebootWaiterSlot 的 `{current}` 契约，不必再包一层对象（包一层会多出
  // 一层嵌套，settle 侧读到的就不是 waiter 了）。
  const rebootWaiterRef = useRef<RebootWaiter<MobileNovelMasterRuntime> | null>(
    null,
  );

  const retryAndWait = useCallback((): Promise<MobileNovelMasterRuntime> => {
    return new Promise<MobileNovelMasterRuntime>((resolve, reject) => {
      const nextGeneration = bootTokenRef.current + 1;
      const outcome = armRebootWaiter<MobileNovelMasterRuntime>(
        rebootWaiterRef,
        nextGeneration,
        {resolve, reject},
      );
      if (outcome === 'joined') {
        // 槽已被占用：**复用**（挂到既有 waiter 上），绝不覆盖。
        // 覆盖会让先到那个调用方的 promise 彻底失主、只能等超时兜底；
        // 同时也不能推进代号——推进会把在途那一代变成谁也兑现不了的孤儿代，
        // 两个调用方一起悬到 60s 超时。
        return;
      }
      bootTokenRef.current = nextGeneration;
      setBootToken(nextGeneration);
    });
  }, []);

  // 超时兜底：effect 若因为任何原因没兑现（理论上 cancelled 分支已 reject），
  // 调用方不能永挂。留 60s 远大于正常重建耗时，只兜「promise 悬空」。
  // 代号取挂 timer 那一刻槽内的代号——挂 timer 之后槽只可能被同一代兑现
  // （代号推进会重跑本 effect 重挂 timer），所以这里传代号与不传是等价的安全。
  useEffect(() => {
    const pending = rebootWaiterRef.current;
    if (pending == null) {
      return;
    }
    const {generation} = pending;
    const rebootTimer = setTimeout(() => {
      settleRebootWaiter(rebootWaiterRef, generation, {
        kind: 'reject',
        error: new Error('重建 runtime 超时，请重试'),
      });
    }, REBOOT_WAIT_TIMEOUT_MS);
    return () => {
      clearTimeout(rebootTimer);
    };
  }, [bootToken]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(undefined);

    const resolveRebootWaiter = (rt: MobileNovelMasterRuntime): void => {
      settleRebootWaiter(rebootWaiterRef, bootToken, {
        kind: 'resolve',
        runtime: rt,
      });
    };
    const rejectRebootWaiter = (err: unknown): void => {
      settleRebootWaiter(rebootWaiterRef, bootToken, {
        kind: 'reject',
        error: err,
      });
    };

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
          // 实时 token 估算（stream-metrics-native ②）：这里只**装配工厂**；编码表
          // 在会话切换时空闲预热，估算器本体在单元 `begin()`（run 起手）同步兜底建
          // （正文/思考各一条，编码名按会话模型解析，未就绪按 cl100k 兜底）。
          tokenEstimatorFactory: sessionId =>
            createSessionStreamTokenEstimator(rt, sessionId),
        }),
      });
      const loaded = await loadMobileScope(runtime);
      const ui = createAppUiPreferences(runtime.kkv);
      const epoch = await syncAppVersionForRichRender(
        ui,
        mobilePackage.version,
      );
      if (cancelled) {
        // svc/B-2：此刻 Manager 已构造（事件订阅、AppState 订阅、通知点按
        // 注册均已生效），直接 return 会泄漏——对齐 bootToken>0 分支的
        // 先 detach 模式：先 dispose（退订 + 清 refcount + 停前台服务 +
        // 写通尽力落盘），再销毁数据库连接。
        runtime.sessionStreamUnitManager.dispose();
        await closeMobileConnection();
        // 同样必须 reject：调用方（云同步 pull）不能永挂在 await 上，
        // 否则它持有的 busy 令牌永不 release。
        rejectRebootWaiter(new Error('重建 runtime 已取消，请重试'));
        return;
      }
      setRuntime(runtime);
      setAppUi(ui);
      setRichRenderEpoch(epoch);
      setScope(loaded);
      setStatus('ready');
      resolveRebootWaiter(runtime);
    })().catch(err => {
      if (!cancelled) {
        setRuntime(undefined);
        setAppUi(undefined);
        setError(formatBootstrapError(err));
        setStatus('error');
      }
      rejectRebootWaiter(err);
    });

    return () => {
      cancelled = true;
    };
  }, [bootToken]);

  // 桥注入（ready 后执行；retry 换新 runtime 时对新 Manager 重新注入）。
  // 桥未注入期间（bootstrap 早期与 retry 窗口）的降级：失败 toast 与完成通知
  // 不发，refcount 与单元维护不依赖桥，始终生效。
  useEffect(() => {
    if (!runtime) {
      return;
    }
    const manager = runtime.sessionStreamUnitManager;
    // 消息正文解压搬运（存量压缩行 → 明文）：runtime 就绪后低优先后台调度
    //（fire-and-forget，幂等——已完成时零成本；Agent 活跃/数据清理 busy 自动让路）。
    // 同一 runtime 重复调度不叠加循环（runtime 身份去重）；retry 换新
    // runtime 时对新连接重挂一次，旧循环随旧连接失效自然终止。
    scheduleMobileMessageContentDecompress(runtime);
    manager.setUiBridge({onError: message => showAppToast(message)});
    // 消息通知总开关：完成通知与常驻保活一体启停；appUi 未就绪的降级
    // 口径取「关」（与开关默认关对齐），appUi 就绪后按存储真值。
    manager.setPrefBridge(createNotificationPrefBridge(() => appUiRef.current));
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
    // 常驻保活启动挂点：桥装配完成后按开关拉起常驻前台服务通知
    // （fire-and-forget；retry 重建 runtime 后本 effect 重跑，dispose 全停
    // → 重新拉起的秒级闪断 PRD 已接受）。
    void ensureKeepAliveResidentBoot(appUiRef.current);
    // 存量 blob 行形态归一（去 base64）的后台循环：同样 fire-and-forget，
    // 幂等挂载（同一 runtime 重复调用不叠加循环）；retry 换新 runtime 时
    // 本 effect 重跑，对新连接重挂一次。
    scheduleMobileBlobBinaryNormalization(runtime);
  }, [runtime]);

  const refreshScope = useCallback(async () => {
    if (!runtime) {
      return;
    }
    const loaded = await loadMobileScope(runtime);
    setScope(loaded);
  }, [runtime]);

  // 实时 token 估算的编码提示预热（stream-metrics-native ②）：会话切换时
  // 异步解析该会话的 vendorModelId（供下一个 run 选 cl100k/o200k）；失败静默，
  // 解析不出就按 cl100k 兜底。提示只影响估算精度，不影响任何持久化语义。
  useEffect(() => {
    if (runtime == null || scope.sessionId == null) {
      return;
    }
    primeStreamTokenModelHint(runtime, scope.sessionId);
  }, [runtime, scope.sessionId]);

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
      retryAndWait,
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
      retryAndWait,
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
