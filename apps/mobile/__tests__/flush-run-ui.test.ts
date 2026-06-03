import {flushAgentStepUi, flushRunUi} from '../src/components/chat/flush-run-ui';

describe('flush-run-ui', () => {
  it('flushAgentStepUi clears stream only after assistant phase', async () => {
    const resets: string[] = [];
    const reloads: string[] = [];
    const reset = () => resets.push('reset');
    const reload = async () => {
      reloads.push('reload');
    };

    await flushAgentStepUi('tool_results', reload, reset);
    expect(resets).toEqual([]);
    expect(reloads).toEqual(['reload']);

    resets.length = 0;
    reloads.length = 0;
    await flushAgentStepUi('assistant', reload, reset);
    expect(resets).toEqual(['reset']);
    expect(reloads).toEqual(['reload']);
  });

  it('flushRunUi always resets after reload', async () => {
    const order: string[] = [];
    await flushRunUi(
      async () => {
        order.push('reload');
      },
      () => order.push('reset'),
    );
    expect(order).toEqual(['reload', 'reset']);
  });
});
