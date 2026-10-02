/**
 * `ChatTranscriptWebViewHandle` 类型单源（chat-webview-unify Step 6 · r1-P0-11）。
 *
 * **为什么搬家**：本类型原先内联在 `ChatTranscriptWebView.tsx` 内。统一宿主
 * `ChatConversationWebView` 也要复用同一套句柄方法面（不新增、不改名），若继续
 * 内联就会出现两份同形声明漂移。故类型定义迁到本文件，组件只做 re-export
 * （旧 import 路径零破坏），四处 type-only import 改直指本文件。
 *
 * **方法面不变**（7 方法）：`session-stream-webview-adapter.ts` / `ChatTabProvider.tsx` /
 * `useInterruptedPartialCommit.ts` / `SubagentSessionScreen.tsx` 的消费代码零改动——
 * 本轮只改各自的 import 路径一行。
 *
 * 统一宿主在七方法之上**追加**了一个 composer 命令式写入方法
 * （`ChatConversationWebViewHandle`，见该文件），那是 chat-webview-unify Step 7 的
 * controller 落点（IME 防线 M7 要求命令式路径与 effect 版 setText 走**相反**的
 * 选区基线规则，故必须是独立通道），对本文件定义的七方法本身无任何增删。
 */
import type {ChatMessage} from '@novel-master/core/chat';
import type {StreamWireChunk} from '@/services/stream-wire-queue';

export type ChatTranscriptWebViewHandle = {
  pushStreamDelta: (kind: 'text' | 'thinking', delta: string) => void;
  pushStreamBatch: (payload: {segments: readonly StreamWireChunk[]}) => void;
  resetStream: () => void;
  /** 流式结束：单次 DOM 提交落库行并清 stream tail（纯文本 assistant）。成功返回 true。 */
  tryCommitStreamTail: (
    allMessages: readonly ChatMessage[],
    prevCount: number,
  ) => boolean;
  /** abort 极早 stop：将 overlay stream tail 固化为 assistant 行（不含 tools）。无 tail 则 skip。 */
  commitAbortOverlaySnapshot: () => boolean;
  /**
   * 强制直发全量快照（Step 6 单元接线的控制消息消费面）：绕过
   * uiRunning+streamActive 的 defer 拦截——subagent 长任务期间消息可见、
   * 重挂后空基线直发均走此路径（对齐组件内 pendingSubagentSessions
   * 变化时的 force 直发语义）。
   */
  forceSnapshot: () => void;
  /**
   * 轻量合成提交（Step 6 中断现场渲染）：把单元持有的 interrupted
   * partial（text/thinking 由调用方传入，不依赖组件本地累积）组装为
   * 一条只读 assistant 终态行经 streamCommit 通道呈现。成功返回 true；
   * webview 未就绪或 partial 全空返回 false。
   */
  commitSyntheticAssistantRow: (text: string, thinking: string) => boolean;
};
