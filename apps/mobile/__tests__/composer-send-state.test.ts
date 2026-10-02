/**
 * Composer 发送态推导（`deriveComposerSendState` / `findLastVisibleMessage`）。
 *
 * ## 为什么有这个文件
 *
 * 这层推导原先没有独立测试面，只被 `chat-composer.integration.test.tsx` 顺带
 * 覆盖（挂真 `ChatComposer`，断发送键 disabled / onPress 是否起 run）。Step 8
 * legacy 转录引擎退役、`ChatComposer.tsx` 删除后那个文件整体退场，这层推导就
 * 成了「Provider 每次渲染都在算、却没有测试」的东西——所以按纯函数域补一份。
 *
 * 分工（其余判定面各有其主，不要在这里重复）：
 * - `isPlainUserText` 的 block 级细账 → `packages/core/test/chat/editable-text-from-message.test.ts`
 *   （T-B3-01/05/06，含 tool_result 守卫）。
 * - 「有没有可发输入」的三元门闩（正文 / attach / 批注）→ `packages/core/test/chat/composer-sendable-input.test.ts`
 *   （T-CR3 / T-CR4 / T-UO3 镜像）。
 * - send 三分支的**路由**（needModel / 空续跑 / 正常发送）→ `use-chat-composer-controller.test.tsx`。
 * - 同一 run 的二次受理被拒、finishRun 的 refcount 兑底 → `SessionStreamUnitManager` 自己的测试面。
 *
 * 本文件只锁 RN 侧这一层薄推导：**取末条可见消息** + **role 决定可否空续跑**。
 */
import {describe, expect, it} from '@jest/globals';
import {type ChatMessage} from '@novel-master/core/chat';
import {
  deriveComposerSendState,
  findLastVisibleMessage,
} from '@/components/chat/composer-send-state';

function message(
  id: string,
  role: 'user' | 'assistant',
  blocks: ChatMessage['content']['blocks'] = [
    {type: 'text', text: 'hi'},
  ],
  hidden = false,
): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq: 1,
    role,
    content: {blocks},
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden,
  };
}

describe('composer-send-state 薄推导', () => {
  it('无消息：不可空续跑、末条非纯文本（发送键全灰）', () => {
    expect(findLastVisibleMessage([])).toBeUndefined();
    expect(deriveComposerSendState(undefined)).toEqual({
      canResumeWithoutInput: false,
      lastMessageIsPlainUserText: false,
    });
  });

  it('findLastVisibleMessage 跳过尾部隐藏消息（隐藏不改可见性语义）', () => {
    const visible = message('m1', 'user');
    const hiddenTail = message('m2', 'assistant', undefined, true);
    expect(findLastVisibleMessage([visible, hiddenTail])).toBe(visible);
  });

  it('末条为 user 纯文本：可空续跑 + 锁「带字发送」', () => {
    const last = message('m1', 'user', [{type: 'text', text: '看这里'}]);
    expect(deriveComposerSendState(last)).toEqual({
      canResumeWithoutInput: true,
      lastMessageIsPlainUserText: true,
    });
  });

  it('T-PM5：末条为含 tool_result 的 user 消息——可空续跑但解锁带字发送', () => {
    // 这是 T-PM5 的核心：tool_result 的 user 轮**不该**被当「纯文本轮」锁死，
    // 用户能接着打字；isPlainUserText 的 tool_result 守卫见 core T-B3-06。
    const last = message('m1', 'user', [
      {type: 'tool_result', toolUseId: 't1', content: 'done', ok: true},
    ]);
    expect(deriveComposerSendState(last)).toEqual({
      canResumeWithoutInput: true,
      lastMessageIsPlainUserText: false,
    });
  });

  it('末条为 assistant：不可空续跑（等回复中），末条非纯文本', () => {
    const last = message('m1', 'assistant');
    expect(deriveComposerSendState(last)).toEqual({
      canResumeWithoutInput: false,
      lastMessageIsPlainUserText: false,
    });
  });
});
