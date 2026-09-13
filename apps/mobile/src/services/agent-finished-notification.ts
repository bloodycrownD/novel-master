/**
 * 生成结束通知 + 前台保活服务（@notifee/react-native 封装）。
 *
 * 职责边界：本模块只管「怎么发通知 / 怎么起停前台服务」——是否发通知的
 * 业务决策（「消息通知」总开关、run 终态）在 SessionStreamUnitManager 侧
 * 完成（经 prefBridge 单一开关查询）。
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
let keepAliveRunning = false;

/** 期望运行态：链上每次 reconcile 都按最新期望值对齐实际状态。 */
let keepAliveDesired = false;

/** per-session 保活标签（Step 5 需求：状态栏展示项目/会话名）。 */
const keepAliveLabels = new Map<string, AgentKeepAliveLabel>();

/** 标签变更版本：驱动运行中通知的内容刷新（无标签变更时保持旧语义不动）。 */
let keepAliveLabelsVersion = 0;
let keepAliveDisplayedVersion = -1;

/** 起停串行化链：所有 start/stop 决策排队执行，消除在途竞态。 */
let keepAliveChain: Promise<void> = Promise.resolve();

/** 保活通知的内容标签：项目名 + 会话名（取不到时对应字段缺省）。 */
export interface AgentKeepAliveLabel {
  readonly projectName?: string;
  readonly sessionTitle?: string;
}

/** 仅测试用：复位保活模块级状态。 */
export function resetKeepAliveStateForTests(): void {
  keepAliveRunning = false;
  keepAliveDesired = false;
  keepAliveLabels.clear();
  keepAliveLabelsVersion = 0;
  keepAliveDisplayedVersion = -1;
  keepAliveChain = Promise.resolve();
}

/**
 * 把一次起/停决策排到链尾，并立即更新期望态。
 *
 * 期望态在入队时写入（而非执行时），所以「stop 在途期间来了 start」
 * 会让链上尚未执行的 stop 直接跳过、或 stop 完成后补一次 start，
 * 两种时序最终都收敛到运行——新 run 不会裸奔。
 */
function enqueueKeepAliveSync(desired: boolean): Promise<void> {
  keepAliveDesired = desired;
  const task = keepAliveChain.then(() => reconcileKeepAlive());
  // 链本身吞错（否则任一 reject 会卡死后续排队），调用侧自行 catch。
  keepAliveChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/**
 * 按最新期望态对齐实际运行态（只在链尾执行，天然串行）。
 *
 * 运行中且标签未变时 no-op（保持既有起停语义）；标签变化（会话加入/收尾）
 * 时同 id 重发通知 = 原位刷新内容（项目 · 会话名随最新 run 更新）。
 */
async function reconcileKeepAlive(): Promise<void> {
  if (
    keepAliveDesired === keepAliveRunning &&
    keepAliveDisplayedVersion === keepAliveLabelsVersion
  ) {
    return;
  }
  if (!keepAliveDesired && !keepAliveRunning) {
    // 从未运行过（如保活开关关着的收尾调用）：对齐版本即可，不必真调 stop。
    keepAliveDisplayedVersion = keepAliveLabelsVersion;
    return;
  }
  if (keepAliveDesired) {
    const {title, body} = buildKeepAliveContent();
    await ensureChannels();
    await notifee.displayNotification({
      id: KEEPALIVE_NOTIFICATION_ID,
      title,
      body,
      android: {
        channelId: CHANNEL_AGENT_KEEPALIVE,
        asForegroundService: true,
        ongoing: true,
        smallIcon: 'ic_launcher',
        // 无 pressAction 时 notifee 不设 contentIntent——Android 点按无任何
        // 反应（连拉起应用都不会）。带 default pressAction：点按拉起应用
        // （launcher），PRESS 事件因无 data.sessionId 走既有 no-op 分支，
        // 不做会话跳转。
        pressAction: {
          id: 'default',
        },
      },
    });
    keepAliveRunning = true;
    keepAliveDisplayedVersion = keepAliveLabelsVersion;
    return;
  }
  try {
    await notifee.stopForegroundService();
  } finally {
    // stop 抛错也要复位标记，否则永久卡 true、之后所有 start 都 no-op。
    keepAliveRunning = false;
    keepAliveDisplayedVersion = -1;
  }
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
 * 启动前台保活服务（dataSync 类型，常驻「正在生成」通知）。
 *
 * 携带 sessionId 时同时登记/刷新该会话的内容标签（状态栏展示项目 · 会话名，
 * 并行多 run 时显示最近一个 + 总数）。仅 Android；无标签调用保持旧语义。
 */
export function startAgentKeepAliveService(
  sessionId?: string,
  label?: AgentKeepAliveLabel,
): Promise<void> {
  if (Platform.OS !== 'android') {
    return Promise.resolve();
  }
  if (sessionId != null) {
    const changed = !labelEquals(keepAliveLabels.get(sessionId), label);
    if (label != null) {
      keepAliveLabels.set(sessionId, label);
    } else {
      keepAliveLabels.delete(sessionId);
    }
    if (changed) {
      keepAliveLabelsVersion += 1;
    }
  }
  return enqueueKeepAliveSync(true);
}

/**
 * 停止前台保活服务。
 *
 * 带 sessionId（单会话 run 收尾）：仅摘除该会话标签——仍有其它会话在跑时
 * 服务继续、通知内容刷新为剩余会话；最后一个标签摘除时服务停止。
 * 不带 sessionId（全部 run 结束 / Manager dispose）：清空全部标签并停止。
 */
export function stopAgentKeepAliveService(sessionId?: string): Promise<void> {
  if (Platform.OS !== 'android') {
    return Promise.resolve();
  }
  if (sessionId != null) {
    if (keepAliveLabels.delete(sessionId)) {
      keepAliveLabelsVersion += 1;
    }
    if (keepAliveLabels.size > 0) {
      // 其它会话仍在跑：刷新内容、维持运行
      return enqueueKeepAliveSync(true);
    }
    return enqueueKeepAliveSync(false);
  }
  if (keepAliveLabels.size > 0) {
    keepAliveLabels.clear();
    keepAliveLabelsVersion += 1;
  }
  return enqueueKeepAliveSync(false);
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

/** 组装保活通知内容：最近登记的会话标签 +（多会话时）总数。 */
function buildKeepAliveContent(): {
  title: string;
  body: string;
} {
  const labels = [...keepAliveLabels.values()];
  const latest = labels[labels.length - 1];
  const scopeText =
    latest == null
      ? ''
      : [latest.projectName, latest.sessionTitle].filter(Boolean).join(' · ');
  const title =
    latest?.sessionTitle != null
      ? `正在生成 · ${latest.sessionTitle}`
      : '正在生成';
  const lines: string[] = [];
  if (scopeText !== '') {
    lines.push(scopeText);
  }
  if (labels.length > 1) {
    lines.push(`共 ${labels.length} 个会话生成中`);
  }
  lines.push('完成后自动结束；期间请勿强行关闭应用');
  return {title, body: lines.join('\n')};
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
