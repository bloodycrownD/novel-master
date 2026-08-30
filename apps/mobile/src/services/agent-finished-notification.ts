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

let tapHandler: ((sessionId: string) => void) | undefined;

/**
 * 前台保活常驻服务是否处于运行态（模块级标记，跨 Manager 实例共享）。
 *
 * retry 重建 runtime 会换 Manager 实例，但 notifee 的前台服务是进程级的，
 * 标记必须放模块级才能避免「新实例重复起服务」。
 */
let keepAliveRunning = false;

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
 * 前台（AppState active）不发；失败通知按会话 5 分钟窗口合并抑制。
 * 通知 data 携带 sessionId，点按路径据此直达会话。
 */
export async function notifyAgentRunFinished(input: {
  readonly sessionId: string;
  readonly sessionTitle: string | null | undefined;
  readonly status: 'finished' | 'failed';
}): Promise<void> {
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
 * 启动前台保活服务（dataSync 类型，常驻「正在生成」通知）。
 *
 * 仅 Android；已在运行时幂等 no-op。JS 侧须已 registerForegroundService，
 * 否则原生侧找不到 runner——本模块顶层已注册常驻 runner（服务随 stop 调用结束）。
 */
export async function startAgentKeepAliveService(): Promise<void> {
  if (Platform.OS !== 'android' || keepAliveRunning) {
    return;
  }
  await ensureChannels();
  await notifee.displayNotification({
    id: KEEPALIVE_NOTIFICATION_ID,
    title: '正在生成',
    body: '生成进行中，完成后自动结束；期间请勿强行关闭应用。',
    android: {
      channelId: CHANNEL_AGENT_KEEPALIVE,
      asForegroundService: true,
      ongoing: true,
      smallIcon: 'ic_launcher',
    },
  });
  keepAliveRunning = true;
}

/** 停止前台保活服务（全部 run 结束 / Manager dispose 时调用）。 */
export async function stopAgentKeepAliveService(): Promise<void> {
  if (Platform.OS !== 'android' || !keepAliveRunning) {
    return;
  }
  await notifee.stopForegroundService();
  keepAliveRunning = false;
}

/**
 * 注册通知点按处理：切 scope 到目标会话（经注入的回调）并导航到 Chat tab。
 *
 * 仅处理 app 存活时的前台事件（onForegroundEvent PRESS）；app 被杀后点通知
 * 属冷启动场景，PRD 未承诺（杀 app 后 run 已终止）。
 */
export function registerAgentNotificationTapHandling(
  onTapSession: (sessionId: string) => void,
): () => void {
  tapHandler = onTapSession;
  return notifee.onForegroundEvent(({type, detail}) => {
    if (type !== EventType.PRESS) {
      return;
    }
    const sessionId = detail?.notification?.data?.sessionId;
    if (typeof sessionId === 'string') {
      tapHandler?.(sessionId);
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
