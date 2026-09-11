/**
 * Chat tab 非运行态残留 hook（Step 7 瘦身后）。
 *
 * 原文件的数据管线（tail 初载/分页/视图缓存/刷新合并）已整体迁入
 * SessionStreamUnitManager 的消息面（有单元走投影、无单元走 idle 路径，
 * 见 manager 的 readMessagesSnapshot/loadSessionTailMessages）——本 hook
 * 只保留与运行态无关的部分：
 * - draftRestoreToken：编辑消息恢复草稿的 UI 令牌；
 * - session-transcript-changed 的 DeviceEventEmitter 监听：详情页压缩/
 *   置位等外部动作改了 DB 的 hidden 行，经 onTranscriptChanged 回调交给
 *   上层（Provider）走 manager 的 force 回源刷新 + token 计数刷新。
 */
import {useEffect, useState} from 'react';
import {DeviceEventEmitter} from 'react-native';

export type UseChatTabMessagesParams = {
  readonly sessionId: string | undefined;
  /**
   * session-transcript-changed 命中当前会话时的回调（Provider 提供：
   * manager force 回源刷新消息面 + 刷新 token 计数）。
   */
  readonly onTranscriptChanged?: () => void;
};

export function useChatTabMessages({
  sessionId,
  onTranscriptChanged,
}: UseChatTabMessagesParams) {
  const [draftRestoreToken, setDraftRestoreToken] = useState(0);

  // 详情页压缩/置位后 DB 消息 hidden 已变，经回调交上层刷新（消息面归
  // manager，本 hook 不再自持 state）。监听随会话切换重建，回调经闭包
  // 取最新。
  useEffect(() => {
    if (sessionId == null) {
      return;
    }
    const sub = DeviceEventEmitter.addListener(
      'session-transcript-changed',
      (e?: {sessionId?: string}) => {
        if (e?.sessionId === sessionId) {
          onTranscriptChanged?.();
        }
      },
    );
    return () => sub.remove();
  }, [sessionId, onTranscriptChanged]);

  return {
    draftRestoreToken,
    setDraftRestoreToken,
  };
}

export type UseChatTabMessagesResult = ReturnType<typeof useChatTabMessages>;
