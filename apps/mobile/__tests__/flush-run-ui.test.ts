import {flushAgentStepUi, flushRunUi} from '../src/components/chat/flush-run-ui';

describe('flush-run-ui', () => {
  // abort 后增列表 reload 守卫在 useChatStreamRuntime / ConversationPanel 层；
  // 本模块在被调用时仍执行 immediate reload（见 T-AC2-3/4/9 集成测）。
  it('flushAgentStepUi reloads then clears stream only after assistant phase', async () => {
    const order: string[] = [];
    const onAssistantStreamEnd = () => order.push('reset');
    const reload = async (options?: { immediate?: boolean }) => {
      order.push(`reload:${options?.immediate ? 'immediate' : 'normal'}`);
      return [{ id: 'm1' }];
    };

    await flushAgentStepUi('tool_results', reload, onAssistantStreamEnd, 0);
    expect(order).toEqual(['reload:immediate']);

    order.length = 0;
    await flushAgentStepUi('assistant', reload, onAssistantStreamEnd, 0);
    expect(order).toEqual(['reload:immediate', 'reset']);
  });

  it('flushRunUi always resets after immediate reload', async () => {
    const order: string[] = [];
    await flushRunUi(
      async options => {
        order.push(`reload:${options?.immediate ? 'immediate' : 'normal'}`);
        return [{ id: 'm1' }];
      },
      () => order.push('reset'),
      0,
    );
    expect(order).toEqual(['reload:immediate', 'reset']);
  });

  it('passes prevCount to stream end handler', async () => {
    let capturedPrev = -1;
    await flushRunUi(
      async () => [{ id: 'm1' }],
      ctx => {
        capturedPrev = ctx.prevCount;
      },
      3,
    );
    expect(capturedPrev).toBe(3);
  });
});
