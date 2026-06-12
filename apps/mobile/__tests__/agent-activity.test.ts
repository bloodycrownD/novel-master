import {
  isMobileAgentActive,
  setMobileAgentActive,
  subscribeMobileAgentActivity,
} from '../src/runtime/agent-activity';

describe('agent-activity', () => {
  afterEach(() => {
    setMobileAgentActive(false);
  });

  it('setMobileAgentActive 会通知订阅者', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeMobileAgentActivity(listener);

    setMobileAgentActive(true);
    expect(isMobileAgentActive()).toBe(true);
    expect(listener).toHaveBeenCalledWith(true);

    setMobileAgentActive(false);
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
    listener.mockClear();
    setMobileAgentActive(true);
    expect(listener).not.toHaveBeenCalled();
  });
});
