import {flushAgentStepUi, flushRunUi} from '../src/components/chat/flush-run-ui';

describe('flush-run-ui', () => {
  it('flushAgentStepUi reloads then clears stream only after assistant phase', async () => {
    const order: string[] = [];
    const reset = () => order.push('reset');
    const reload = async () => {
      order.push('reload');
    };

    await flushAgentStepUi('tool_results', reload, reset);
    expect(order).toEqual(['reload']);

    order.length = 0;
    await flushAgentStepUi('assistant', reload, reset);
    expect(order).toEqual(['reload', 'reset']);
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
