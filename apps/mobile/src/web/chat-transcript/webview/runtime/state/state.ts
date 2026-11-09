/**
 * chat-transcript boot 共享状态与版本常量。
 */
import {DEFAULT_LABELS, type TranscriptLabels} from '../../ui/labels';

export const SCHEMA_V = 2;
export const BRIDGE_V = 1;
export const VFS_FILE_TOOLS: Record<string, number> = {
  read: 1,
  write: 1,
  edit: 1,
};

/** 工具调用行（渲染用最小字段）。 */
export type ToolCallRow = {
  name?: string;
  status?: string;
  summary?: string;
  input?: Record<string, unknown> | null;
  resultContent?: unknown;
  /** 工具调用 id：结果阅读分支按它从 state.rows 反查 resultContent（同 subagentSessionId，运行时数据已挂，这里补类型声明）。 */
  toolUseId?: string;
  /** 子智能体会话 id：非空时卡片可点击进入子会话只读浏览。applySnapshot 是浅引用赋值，运行时数据已挂在对象上，这里只是补类型声明。 */
  subagentSessionId?: string;
  /** skill 跳转三元组：read 由 tool_result meta 透传；write/edit 由 skill-tool-ref.ts 从 input 解析。 */
  skillRef?: SkillRefMeta;
};

/** skill 卡片跳详情三元组（与 core SkillToolRef 同形）。 */
export type SkillRefMeta = {
  domain: 'global' | 'project';
  projectId?: string;
  name: string;
};

/** 消息附件芯片。 */
export type AttachmentChip = {
  source?: string;
  type?: string;
  name?: string;
  path?: string;
  /** skillAttach 专用：技能名真源（message-blocks 行构建透传；旧数据可能缺省）。 */
  skillName?: string;
  action?: string;
  content?: string | null;
};

/** 行状态：流式起源的行恒有；纯历史行没有该字段。 */
export type TranscriptRowStatus = 'streaming' | 'finished';

/** 普通消息行。 */
export type MessageRow = {
  kind: 'message';
  /** 行身份：流式行 = streamId；历史行 = DB message id。 */
  id: string;
  /** DB message id：流式期间缺省，DB 接管后补齐。菜单/回滚/分叉/置位只用它。 */
  messageId?: string;
  role?: string;
  /** 流式起源的行恒有 status；纯历史行没有该字段。 */
  status?: TranscriptRowStatus;
  text?: string;
  textHtml?: string;
  thinking?: string;
  thinkingHtml?: string;
  tools?: ToolCallRow[];
  attachments?: AttachmentChip[];
  hidden?: boolean;
};

export type TranscriptRow = MessageRow;

export type TranscriptFlags = {
  richText: boolean;
  menuDisabled: boolean;
};

/** 流式检查点（spec §2.3.5 / C20）：任意 snapshot 携带到的最后内容序号。 */
export type StreamCheckpoint = {
  id: string;
  seq: number;
  status: TranscriptRowStatus;
};

export type MenuItem = {
  label: string;
  action: string;
  danger?: boolean;
};

export type MenuAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ContextMenuState = {
  messageId: string;
  pageX: number;
  pageY: number;
  anchor: MenuAnchor;
  items: MenuItem[];
};

type TranscriptState = {
  nearBottom: boolean;
  sessionKey: string;
  rows: TranscriptRow[];
  hasMore: boolean;
  /** 当前/最近一条流式行的检查点；null = 没有流式行。 */
  streamCheckpoint: StreamCheckpoint | null;
  /** gap 等待中的 streamId；snapshot 到达后清空。 */
  resyncPending: string | null;
  /** 上一次 requestResync 发出的时间（performance.now）；同一 streamId 100ms 限流，snapshot 后保留。 */
  resyncSentAt: number | null;
  /** 连续异常快照计数；正常快照不变量通过后清零，连续 3 次停止自动 resync。 */
  snapshotResyncAnomalyCount: number;
  /** 连续异常退避截止（performance.now）；null = 不在退避。 */
  snapshotResyncBackoffUntil: number | null;
  /** 渲染层文案（宿主 init.labels 下发；缺省回退默认中文）。 */
  labels: TranscriptLabels;
  /** 快照 seed/gap 恢复后的 streamId：只接受全量 textHtml，忽略 tailHtml/块提交。 */
  fullReplaceOnly: string | null;
  /** 当前 stream 已应用的块 key 集合（重复投递幂等）。 */
  appliedBlockKeys: Set<string>;
  /** 该 streamId 已用富文本 html reseed 过（richText 从关到开时强制重播一次）。 */
  lastStreamHtmlStreamId: string | null;
  /** richText 从开→关时需要把该 streaming 行 body 重写为纯文本的 id；仅 !flags.richText 时消费。 */
  plainReseedStreamId: string | null;
  flags: TranscriptFlags;
  menu: ContextMenuState | null;
  menuOverlayHandler: ((event: Event) => void) | null;
  menuNativeTextBlockHandler: ((event: Event) => void) | null;
  thinkingExpanded: Record<string, boolean>;
  toolGroupExpanded: Record<string, boolean>;
  attachGroupExpanded: Record<string, boolean>;
  scrollRaf: number | null;
  loadOlderArmed: boolean;
  menuOpenedAt: number;
};

export const state: TranscriptState = {
  nearBottom: true,
  sessionKey: '',
  rows: [],
  hasMore: false,
  streamCheckpoint: null,
  resyncPending: null,
  resyncSentAt: null,
  snapshotResyncAnomalyCount: 0,
  snapshotResyncBackoffUntil: null,
  labels: DEFAULT_LABELS,
  fullReplaceOnly: null,
  appliedBlockKeys: new Set(),
  lastStreamHtmlStreamId: null,
  plainReseedStreamId: null,
  flags: {richText: false, menuDisabled: false},
  menu: null,
  menuOverlayHandler: null,
  menuNativeTextBlockHandler: null,
  thinkingExpanded: {},
  toolGroupExpanded: {},
  attachGroupExpanded: {},
  scrollRaf: null,
  loadOlderArmed: true,
  menuOpenedAt: 0,
};
