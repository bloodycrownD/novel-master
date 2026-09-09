/**
 * 生成结束通知 + 前台保活服务（@notifee/react-native 封装）。
 *
 * 职责边界：本模块只管「怎么发通知 / 怎么起停前台服务」——是否发通知的
 * 业务决策（偏好开关、run 终态）在 AgentRunManager 侧完成。
 *
 * 前台/后台口径：app 在前台（AppState active，任意页面）一律不发完成通知，
 * 前台界面自有完成反馈；仅后台时发。
 *
 * @module services/agent-finished-notification
 */
import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  EventType,
} from '@notifee/react-native';
import {AppState, Platform} from 'react-native';
import {navigationContainerRef} from '@/navigation/navigation-container-ref';

/** 完成通知 channel（IMPORTANCE_DEFAULT：有横幅、不响铃）。 */
const CHANNEL_AGENT_FINISHED = 'agent-finished';
/** 前台保活常驻通知 channel（IMPORTANCE_LOW：静默常驻）。 */
const CHANNEL_AGENT_KEEPALIVE = 'agent-keepalive';
/** 前台保活常驻通知的稳定 id（stopForegroundService 按服务停，id 仅用于覆盖展示）。 */
const KEEPALIVE_NOTIFICATION_ID = 'nm-agent-keepalive';

/** 同会话失败通知的合并窗口（毫秒）——频繁失败只发一条，防噪音。 */
const FAILED_NOTIFY_MERGE_WINDOW_MS = 5 * 60 * 1000;

/** 各会话最近一次失败通知的发出时间戳（ms）。 */
const lastFailedNotifyAt = new Map<string, number>();

/** 权限被拒绝后的降级标记——之后不再重复申请（拒绝时保活照常、仅无通知）。 */
let permissionDenied = false;

let channelsReady = false;

/**
 * 点按处理入口（前台/后台共用）：Manager 构造时替换引用，dispose 后置空。
 * 允许返回 Promise：后台 headless 路径要等 scope 切换落盘后才结束任务。
 */
let tapHandler: ((sessionId: string) => void | Promise<void>) | undefined;

/**
 * 后台点按的待导航意图：headless 里导航容器多半未 ready，先记录，
 * 回前台后消费一次（见模块级 AppState 监听）。
 */
let pendingTapNavigation = false;

/**
 * 前台保活常驻服务是否处于运行态（模块级标记，跨 Manager 实例共享）。
 *
 * retry 重建 runtime 会换 Manager 实例，但 notifee 的前台服务是进程级的，
 * 标记必须放模块级才能避免「新实例重复起服务」。
 */
/** per-session 保活标签（Step 5 需求：一个会话一条常驻通知，点按直达对应会话）。 */
const keepAliveLabels = new Map<string, AgentKeepAliveLabel>();

/** 已按此标签内容显示过（同标签重复登记时抑制无谓重发）。 */
const keepAliveDisplayed = new Map<string, AgentKeepAliveLabel>();

/**
 * 前台服务载体会话：Android 的 startForeground 是替换语义——同一条
 * 服务上后发的 asForegroundService 通知会顶掉前一条，故同一时刻只有
 * 一条通知能挂 asForegroundService（载体）；其余会话为普通 ongoing
 * 通知。载体会话收尾时把载体身份转交给剩余会话（先转交后撤旧条，
 * 避免 FGS 通知被撤引发服务停止）。
 */
let keepAliveCarrierSession: string | null = null;

/** 起停串行化链：所有通知操作排队执行，消除在途竞态（MF-4）。 */
let keepAliveChain: Promise<void> = Promise.resolve();

/** 保活通知的内容标签：项目名 + 会话名（取不到时对应字段缺省）。 */
export interface AgentKeepAliveLabel {
  readonly projectName?: string;
  readonly sessionTitle?: string;
}

function keepAliveNotificationId(sessionId: string): string {
  return `${KEEPALIVE_NOTIFICATION_ID}-${sessionId}`;
}

/** 仅测试用：复位保活模块级状态。 */
export function resetKeepAliveStateForTests(): void {
  keepAliveLabels.clear();
  keepAliveDisplayed.clear();
  keepAliveCarrierSession = null;
  keepAliveChain = Promise.resolve();
}

function enqueueKeepAlive(task: () => Promise<void>): Promise<void> {
  const run = keepAliveChain.then(task);
  // 链本身吞错（否则任一 reject 会卡死后续排队），调用侧自行 catch。
  keepAliveChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 启动（登记）某会话的常驻通知：一个会话一条，内容随标签、
 * data.sessionId 供点按直达。标签内容未变时抑制无谓重发。
 */
export function startAgentKeepAliveService(
  sessionId: string,
  label: AgentKeepAliveLabel,
): Promise<void> {
  if (Platform.OS !== 'android') {
    return Promise.resolve();
  }
  keepAliveLabels.set(sessionId, label);
  return enqueueKeepAlive(async () => {
    if (labelEquals(keepAliveDisplayed.get(sessionId), label)) {
      return;
    }
    await ensureChannels();
    await notifee.displayNotification(
      buildKeepAliveNotification(
        sessionId,
        label,
        keepAliveCarrierSession == null,
      ),
    );
    if (keepAliveCarrierSession == null) {
      keepAliveCarrierSession = sessionId;
    }
    keepAliveDisplayed.set(sessionId, label);
  });
}

/**
 * 停止某会话的常驻通知：摘标签并撤该会话的通知条；最后一个会话收尾时
 * 一并停止前台服务。不带 sessionId（dispose）：全部撤下并停止服务。
 */
export function stopAgentKeepAliveService(sessionId?: string): Promise<void> {
  if (Platform.OS !== 'android') {
    return Promise.resolve();
  }
  const targets = sessionId != null ? [sessionId] : [...keepAliveLabels.keys()];
  if (targets.every(t => !keepAliveLabels.has(t))) {
    // 从未登记（如保活开关关闭时的收尾调用）：安全 no-op
    return Promise.resolve();
  }
  // 调用时即摘除意图标记：任务执行时若标签已回到集合（stop 后立即 start
  // 重登记），说明该会话又活跃了——通知原样保留，本次 stop 整体跳过。
  if (sessionId != null) {
    keepAliveLabels.delete(sessionId);
  }
  return enqueueKeepAlive(async () => {
    if (sessionId == null) {
      // dispose：全部撤下并停止服务
      for (const t of targets) {
        keepAliveLabels.delete(t);
        keepAliveDisplayed.delete(t);
      }
      keepAliveCarrierSession = null;
      await notifee.stopForegroundService();
      return;
    }
    if (keepAliveLabels.has(sessionId)) {
      // stop→start 竞态：重登记在先，通知与载体原样保留
      return;
    }
    keepAliveDisplayed.delete(sessionId);
    if (keepAliveCarrierSession === sessionId) {
      // 载体会话收尾：先转交（再挂一条 FGS 通知，startForeground 替换语义
      // 自动撤旧条），无剩余会话才停服务。
      const successor = keepAliveLabels.keys().next().value ?? null;
      if (successor != null) {
        const successorLabel = keepAliveLabels.get(successor)!;
        keepAliveCarrierSession = successor;
        keepAliveDisplayed.delete(successor); // 载体形态变化，强制重发
        await notifee.displayNotification(
          buildKeepAliveNotification(successor, successorLabel, true),
        );
        keepAliveDisplayed.set(successor, successorLabel);
        return;
      }
      keepAliveCarrierSession = null;
      await notifee.stopForegroundService();
      return;
    }
    // 普通会话收尾：仅撤自己的通知条
    await notifee
      .cancelNotification(keepAliveNotificationId(sessionId))
      .catch(() => undefined);
  });
}

function buildKeepAliveNotification(
  sessionId: string,
  label: AgentKeepAliveLabel,
  asForegroundService: boolean,
): {
  id: string;
  title: string;
  body: string;
  data: {sessionId: string};
  android: {
    channelId: string;
    asForegroundService: boolean;
    ongoing: boolean;
    smallIcon: string;
    pressAction: {id: string};
  };
} {
  const title =
    label.sessionTitle != null
      ? `正在生成 · ${label.sessionTitle}`
      : '正在生成';
  const scopeText = [label.projectName, label.sessionTitle]
    .filter(Boolean)
    .join(' · ');
  const body =
    (scopeText !== '' ? `${scopeText}\n` : '') +
    '完成后自动结束；期间请勿强行关闭应用';
  return {
    id: keepAliveNotificationId(sessionId),
    title,
    body,
    data: {sessionId},
    android: {
      channelId: CHANNEL_AGENT_KEEPALIVE,
      asForegroundService,
      ongoing: true,
      smallIcon: 'ic_launcher',
      // 无 pressAction 时 notifee 不派发点按事件（退化为系统默认打开应用），
      // 跳转链路依赖它——与完成通知同型。
      pressAction: {
        id: 'default',
      },
    },
  };
}

function labelEquals(
  a: AgentKeepAliveLabel | undefined,
  b: AgentKeepAliveLabel | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  return a.projectName === b.projectName && a.sessionTitle === b.sessionTitle;
}

async function ensureChannels(): Promise<void> {
  if (channelsReady) {
    return;
  }
  await notifee.createChannel({
    id: CHANNEL_AGENT_FINISHED,
    name: '生成结束通知',
    importance: AndroidImportance.DEFAULT,
  });
  await notifee.createChannel({
    id: CHANNEL_AGENT_KEEPALIVE,
    name: '生成进行中',
    importance: AndroidImportance.LOW,
  });
  channelsReady = true;
}

/**
 * 申请 Android 13+ POST_NOTIFICATIONS 运行时权限。
 *
 * 申请时机由调用方（AgentRunManager）钉死为「首次发起 run 且通知开关为开」。
 * 拒绝后置降级标记、不再重复申请；Android 13 以下与 iOS 直接视为已授权
 * （iOS 本次不承诺通知，实际不走到发送路径）。
 */
export async function ensureAgentNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 33) {
    return true;
  }
  if (permissionDenied) {
    return false;
  }
  const settings = await notifee.requestPermission();
  const granted =
    settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
  if (!granted) {
    permissionDenied = true;
  }
  return granted;
}

/** 是否重置权限降级标记（仅测试用）。 */
export function resetAgentNotificationPermissionStateForTests(): void {
  permissionDenied = false;
}

/** app 是否在前台（active）。 */
export function isAppInForeground(): boolean {
  return AppState.currentState === 'active';
}

/** 清除失败合并窗口记录（仅测试用）。 */
export function resetFailedNotifyMergeStateForTests(): void {
  lastFailedNotifyAt.clear();
}

/**
 * 发送「生成结束」本地通知。
 *
 * 平台门禁在最前（iOS 本次不承诺通知，且 createChannel / android channel
 * 均为 Android-only）；失败合并窗口的写入在门禁之后，避免 iOS 消耗窗口
 * 状态、期间真实失败被误抑制。
 *
 * 前台（AppState active）不发；失败通知按会话 5 分钟窗口合并抑制。
 * 通知 data 携带 sessionId，点按路径据此直达会话。
 */
export async function notifyAgentRunFinished(input: {
  readonly sessionId: string;
  readonly sessionTitle: string | null | undefined;
  readonly status: 'finished' | 'failed';
}): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  // 前台一律不发（含停留生成中会话的界面——前台自有完成反馈）。
  if (isAppInForeground()) {
    return;
  }
  if (input.status === 'failed') {
    const now = Date.now();
    const last = lastFailedNotifyAt.get(input.sessionId) ?? 0;
    if (now - last < FAILED_NOTIFY_MERGE_WINDOW_MS) {
      return;
    }
    lastFailedNotifyAt.set(input.sessionId, now);
  }
  await ensureChannels();
  await notifee.displayNotification({
    id: `nm-agent-finished-${input.sessionId}`,
    title: input.status === 'finished' ? '生成完成' : '生成失败',
    body:
      input.sessionTitle != null && input.sessionTitle !== ''
        ? `「${input.sessionTitle}」${
            input.status === 'finished' ? '生成结束' : '的生成已中断'
          }`
        : input.status === 'finished'
        ? '本次生成已结束'
        : '本次生成已中断',
    data: {sessionId: input.sessionId},
    android: {
      channelId: CHANNEL_AGENT_FINISHED,
      smallIcon: 'ic_launcher',
      pressAction: {
        id: 'default',
      },
    },
  });
}

/**
 * 注册通知点按处理：切 scope 到目标会话（经注入的回调）并导航到 Chat tab。
 *
 * 前台事件（onForegroundEvent PRESS）返回退订函数，由调用方（Manager）
 * 在 dispose 时退订；app 被杀后点通知属冷启动场景，PRD 未承诺
 * （杀 app 后 run 已终止）。
 */
export function registerAgentNotificationTapHandling(
  onTapSession: (sessionId: string) => void | Promise<void>,
): () => void {
  tapHandler = onTapSession;
  return notifee.onForegroundEvent(({type, detail}) => {
    if (type !== EventType.PRESS) {
      return;
    }
    const sessionId = detail?.notification?.data?.sessionId;
    if (typeof sessionId === 'string') {
      void tapHandler?.(sessionId);
    }
  });
}

/** 通知点按后的编程式导航：回根 stack 并落到 Chat tab。 */
export function navigateToChatTabFromNotification(): void {
  const ref = navigationContainerRef;
  if (!ref.isReady()) {
    return;
  }
  // MainTabs 的参数为 NavigatorScreenParams；无类型参数时用泛型安全的裸 navigate。
  (ref.navigate as (name: string, params?: {screen?: string}) => void)(
    'MainTabs',
    {screen: 'Chat'},
  );
}

// 前台服务 runner：常驻 promise（既不 resolve 也不 reject），
// 服务由 stopAgentKeepAliveService 的 stopForegroundService 主动结束。
// 必须在任何 asForegroundService 通知展示之前注册。
if (Platform.OS === 'android') {
  notifee.registerForegroundService(() => new Promise(() => undefined));
}

// 后台点按（MF-3）：notifee 9.x 的 onBackgroundEvent 返回 void、没有退订函数，
// 只能模块级注册一次；handler 需要变化时替换上面的 tapHandler 引用
// （与 onForegroundEvent 共用同一入口）。注册放模块级而非 Manager 构造时，
// 避免 app 存活但 runtime 未装配时 headless 事件到达而 handler 未就绪。
// observer 必须返回 Promise<void>（headless 语义：notifee 等 promise 结束才标记任务完成），
// 这里等 scope 切换（tapHandler）落盘后再记录导航意图。
notifee.onBackgroundEvent(async ({type, detail}) => {
  if (type !== EventType.PRESS) {
    return;
  }
  const sessionId = detail?.notification?.data?.sessionId;
  if (typeof sessionId !== 'string') {
    return;
  }
  await tapHandler?.(sessionId);
  // headless 里导航大概率不可达（容器未 ready），记录待导航意图，回前台后消费。
  pendingTapNavigation = true;
});

// 回前台消费后台点按留下的导航意图（模块级单次注册，与进程同生命周期）。
AppState.addEventListener('change', state => {
  if (state === 'active' && pendingTapNavigation) {
    pendingTapNavigation = false;
    navigateToChatTabFromNotification();
  }
});
