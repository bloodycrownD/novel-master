/**
 * RN ↔ Web transcript 桥层数据类型（postMessage payload 的桥层形状）。
 *
 * 下行信封与宽松解码的唯一真源在 `ChatConversationBridge.ts`；本文件只保留
 * 两端共享的载荷/行/主题类型，避免 web bundle 引 RN 模块。旧的零消费编解码
 * 函数（encode/decode/parseScrollSnapshot）已随 C1 删除。
 */
export {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION} from '../../services/chat-transcript-scroll-cache';
export type {ChatTranscriptScrollSnapshot} from '../../services/chat-transcript-scroll-cache';
import type {ChatTranscriptScrollSnapshot} from '../../services/chat-transcript-scroll-cache';

export type TranscriptToolView = {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly status: string;
  readonly resultContent?: string;
  readonly summary?: string;
  /** task 工具的子会话跳转 id（对称 vfs 工具卡片的可点路径）。 */
  readonly subagentSessionId?: string;
  /** skill 跳转三元组（read 由 tool_result meta 透传；write/edit 由 Web 侧从 input 解析）。 */
  readonly skillRef?: TranscriptSkillRef;
};

/** skill 卡片跳详情三元组（与 core SkillToolRef 同形，桥接层独立声明避免拉入 core 类型）。 */
export type TranscriptSkillRef = {
  readonly domain: 'global' | 'project';
  readonly projectId?: string;
  readonly name: string;
};

/** Rows sent to Web (seq ascending; Web renders forward DOM order). */
type TranscriptAttachmentView = {
  readonly source: 'workplace' | 'attach' | 'user_ops';
  readonly type: 'text' | 'image' | 'dir';
  readonly name: string;
  readonly path: string;
  /** 结构化 action（中文 chip 真源）；缺省时 Web 侧按 name 降级。 */
  readonly action?:
    | 'delete'
    | 'write'
    | 'edit'
    | 'mkdir'
    | 'rename'
    | 'move'
    | 'workplaceChange'
    | 'userAttach'
    | 'annotate'
    | 'skillAttach';
  readonly content?: string | null;
};

/** 流式行状态（spec §2.1.1）：流式起源的行恒有 status；纯历史行没有该字段。 */
export type TranscriptRowStatus = 'streaming' | 'finished';

export type TranscriptRow = {
  readonly kind: 'message';
  /** 行身份：流式行 = streamId；历史行 = DB message id（I5）。 */
  readonly id: string;
  /** DB message id：流式期间缺省，DB 接管后补齐；菜单/回滚/分叉用它。 */
  readonly messageId?: string;
  readonly role: 'user' | 'assistant';
  readonly hidden: boolean;
  /** 流式 origin 的行带 status；历史行缺省（spec §2.1.1）。 */
  readonly status?: TranscriptRowStatus;
  readonly text: string;
  readonly thinking: string;
  /** Embedded tool group for assistant messages with tool_use. */
  readonly tools?: readonly TranscriptToolView[];
  /** Pre-rendered assistant HTML when flags.richText (Web innerHTML). */
  readonly textHtml?: string;
  readonly thinkingHtml?: string;
  /** user 消息附件摘要（展开为工具调用风格卡片）。 */
  readonly attachments?: readonly TranscriptAttachmentView[];
};

export type TranscriptFlags = {
  readonly richText: boolean;
  /** When true, message action menu (⋯) is suppressed (e.g. agent running). */
  readonly menuDisabled?: boolean;
};

/**
 * 快照携带的流式检查点（spec §2.2.2）：本快照 `rows` 已包含到 `seq` 的最后内容。
 * `status` 跟随最后一条流式行（streaming/finished）。
 */
export type TranscriptStreamCheckpoint = {
  readonly id: string;
  readonly seq: number;
  readonly status: TranscriptRowStatus;
};

/**
 * 宿主 → Web 的流式行投影（spec §2.1.2；与 unit 的
 * `SessionStreamMessageProjection` 结构同形、分属两层）。
 */
export type TranscriptStreamingMessage = {
  readonly streamId: string;
  readonly status: TranscriptRowStatus;
  readonly text: string;
  readonly thinking: string;
  readonly tools: readonly TranscriptToolView[];
  /** DB message id：流式中为 null，DB 接管后补齐。 */
  readonly messageId: string | null;
};

/** 转录渲染层文案（`init.labels` 下发；web 缺省回退内置中文常量）。 */
export type TranscriptLabels = {
  readonly generating: string;
  readonly thinking: string;
  readonly empty: string;
  readonly loadOlder: string;
};

/** 流式 delta 的一段正文/思考（顺序即追加顺序）。 */
type TranscriptStreamSegment = {
  readonly kind: 'text' | 'thinking';
  readonly delta: string;
};

/**
 * `streamDelta` 载荷（spec §2.2.3）：`seq` 由宿主在最终 post 时分配，
 * 1 起连续；`textHtml/thinkingHtml` 是全量正文 HTML（含已提交块 + 活跃尾块）。
 */
export type TranscriptStreamDeltaPayload = {
  readonly streamId: string;
  readonly seq: number;
  readonly segments: readonly TranscriptStreamSegment[];
  readonly textHtml?: string;
  readonly thinkingHtml?: string;
  /** 活跃尾块 HTML（块级增量 DOM 专用；非块模式忽略）。 */
  readonly tailHtml?: string;
  readonly thinkingTailHtml?: string;
  /** 完整 tool 数组快照（仅 tool 状态变化时携带）。 */
  readonly tools?: readonly TranscriptToolView[];
};

/** `streamBlockCommit` 载荷（spec §2.2.4）：seq 只做对账，不推进 checkpoint。 */
export type TranscriptStreamBlockCommitPayload = {
  readonly streamId: string;
  /** 本块提交所对应的 delta seq。 */
  readonly seq: number;
  /** 块身份 `<streamId>:<kind>:<commitOrdinal>`；Web 用已应用集合去重。 */
  readonly blockKey: string;
  readonly kind: 'text' | 'thinking';
  readonly html?: string;
  readonly text: string;
  readonly tailHtml?: string;
  readonly tailText?: string;
};

/** `streamStatus` 载荷（spec §2.2.5）：收尾只改 status，`row` 为完整终态行。 */
export type TranscriptStreamStatusPayload = {
  readonly streamId: string;
  readonly status: 'finished';
  readonly messageId?: string;
  readonly row?: TranscriptRow;
};

/** `streamReset` 载荷（spec §2.2.6）：`streamIds` 缺省 = 删除最后一条 streaming 行。 */
export type TranscriptStreamResetPayload = {
  readonly streamIds?: readonly string[];
  /** 宿主分配的快照代次：Web 用它作废在途旧快照。 */
  readonly generation: number;
};

export type TranscriptScrollIntent = 'stick' | 'restore' | 'preserve';

export type TranscriptRestoreScroll = {
  readonly offsetY: number;
  readonly nearBottom: boolean;
};

// nm-style: keep-public — 旧 transcript 独立信封的 v 号契约（web runtime 上行恒
// v:1）；宿主解码真源已迁 ChatConversationBridge，此处只锁协议形状。
export const CHAT_TRANSCRIPT_BRIDGE_VERSION = 1 as const;

// nm-style: keep-public — 跨端 envelope 协议类型（host ↔ web postMessage 形状
// 真源；chat-transcript-stream-block 的源面契约测试锁 streamStatus/streamResync）。
export type BridgeEnvelope<T extends string, P> = {
  readonly v: typeof CHAT_TRANSCRIPT_BRIDGE_VERSION;
  readonly type: T;
  readonly payload: P;
};

// nm-style: keep-public — init/themeUpdate 载荷的主题形状（旧 transcript 独立入口
// 协议面；当前宿主用 ConversationTheme 超集）。
/** init/theme 载荷主题（宿主现用 ConversationTheme 超集）。 */
export type TranscriptTheme = {
  readonly background: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly primary: string;
  readonly danger: string;
  readonly surface: string;
  readonly borderLight: string;
};

// nm-style: keep-public — Host → Web 全量下行协议类型（跨端契约；当前宿主发送面// 由 ChatConversationBridge 的 ConversationHostMessage 镜像）。
export type HostToTranscriptMessage =
  | BridgeEnvelope<
      'init',
      {
        theme: TranscriptTheme;
        flags: TranscriptFlags;
        labels?: TranscriptLabels;
      }
    >
  | BridgeEnvelope<
      'sessionSnapshot',
      {
        sessionKey: string;
        rows: readonly TranscriptRow[];
        hasMore: boolean;
        stream?: TranscriptStreamCheckpoint;
        scrollIntent?: TranscriptScrollIntent;
        restoreScroll?: TranscriptRestoreScroll;
        generation: number;
        chunkIndex: number;
        chunkTotal: number;
      }
    >
  | BridgeEnvelope<
      'prependPage',
      {rows: readonly TranscriptRow[]; prependedCount: number}
    >
  | BridgeEnvelope<'appendTailRows', {rows: readonly TranscriptRow[]}>
  | BridgeEnvelope<'streamDelta', TranscriptStreamDeltaPayload>
  | BridgeEnvelope<'streamBlockCommit', TranscriptStreamBlockCommitPayload>
  | BridgeEnvelope<'streamReset', TranscriptStreamResetPayload>
  | BridgeEnvelope<'streamStatus', TranscriptStreamStatusPayload>
  | BridgeEnvelope<'themeUpdate', {theme: TranscriptTheme}>
  | BridgeEnvelope<'flagsUpdate', {flags: TranscriptFlags}>
  | BridgeEnvelope<'closeMenu', Record<string, never>>
  | BridgeEnvelope<'closeMermaidViewer', Record<string, never>>;

// nm-style: keep-public — Transcript → Host 上行协议类型（跨端契约；含 streamResync
// 与 scrollSnapshot 的两段 published shape）。
export type TranscriptToHostMessage =
  | BridgeEnvelope<
      'ready',
      {version: string; capabilities?: readonly string[]; readyState?: string}
    >
  | BridgeEnvelope<
      'scrollSnapshot',
      ChatTranscriptScrollSnapshot & {
        scrollHeight: number;
        clientHeight: number;
      }
    >
  | BridgeEnvelope<'loadOlder', Record<string, never>>
  | BridgeEnvelope<
      'openMessageMenu',
      {messageId: string; pageX: number; pageY: number}
    >
  | BridgeEnvelope<'openToolFile', {path: string}>
  | BridgeEnvelope<'linkClick', {href: string}>
  | BridgeEnvelope<'openSubagentSession', {sessionId: string}>
  | BridgeEnvelope<
      'openSkillDetail',
      {domain: 'global' | 'project'; projectId?: string; name: string}
    >
  | BridgeEnvelope<
      'openToolResult',
      {title: string; content: string; inputJson?: string}
    >
  | BridgeEnvelope<'messageMenuAction', {messageId: string; action: string}>
  | BridgeEnvelope<'menuOpened', Record<string, never>>
  | BridgeEnvelope<'menuClosed', Record<string, never>>
  | BridgeEnvelope<'mermaidViewerOpened', Record<string, never>>
  | BridgeEnvelope<'mermaidViewerClosed', Record<string, never>>
  | BridgeEnvelope<'copyCode', {code: string}>
  | BridgeEnvelope<'streamResync', {streamId: string; expectedSeq: number}>
  | BridgeEnvelope<'visibility', {hidden: boolean}>;

// nm-style: keep-public — 协议 type 清单（跨端路由表契约）。
export type HostToTranscriptType = HostToTranscriptMessage['type'];
// nm-style: keep-public — 协议 type 清单（跨端路由表契约）。
export type TranscriptToHostType = TranscriptToHostMessage['type'];
