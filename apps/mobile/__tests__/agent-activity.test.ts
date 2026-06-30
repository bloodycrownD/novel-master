import {
  decrementAgentActive,
  incrementAgentActive,
  isMobileAgentActive,
  setMobileAgentActive,
  subscribeMobileAgentActivity,
} from '../src/runtime/agent-activity';

describe('agent-activity', () => {
  afterEach(() => {
    setMobileAgentActive(false);
  });

  describe('refcount', () => {
    it('increment 后 isMobileAgentActive 为 true', () => {
      expect(isMobileAgentActive()).toBe(false);
      incrementAgentActive();
      expect(isMobileAgentActive()).toBe(true);
    });

    it('decrement 至 0 后 isMobileAgentActive 为 false', () => {
      incrementAgentActive();
      decrementAgentActive();
      expect(isMobileAgentActive()).toBe(false);
    });

    it('多次 increment 需等量 decrement 才回落', () => {
      incrementAgentActive();
      incrementAgentActive();
      expect(isMobileAgentActive()).toBe(true);

      decrementAgentActive();
      expect(isMobileAgentActive()).toBe(true);

      decrementAgentActive();
      expect(isMobileAgentActive()).toBe(false);
    });

    it('decrement 在计数为 0 时幂等', () => {
      decrementAgentActive();
      decrementAgentActive();
      expect(isMobileAgentActive()).toBe(false);
    });

    it('refcount 变化会通知订阅者', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeMobileAgentActivity(listener);

      incrementAgentActive();
      expect(listener).toHaveBeenCalledWith(true);

      decrementAgentActive();
      expect(listener).toHaveBeenCalledWith(false);

      unsubscribe();
    });

    it('嵌套 increment 仅在首次与末次 decrement 时通知', () => {
      const listener = jest.fn();
      subscribeMobileAgentActivity(listener);

      incrementAgentActive();
      incrementAgentActive();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith(true);

      decrementAgentActive();
      expect(listener).toHaveBeenCalledTimes(1);

      decrementAgentActive();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenLastCalledWith(false);
    });
  });

  describe('setMobileAgentActive（废弃兼容）', () => {
    it('会通知订阅者', () => {
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

    it('覆盖 refcount 状态', () => {
      incrementAgentActive();
      incrementAgentActive();
      setMobileAgentActive(false);
      expect(isMobileAgentActive()).toBe(false);

      setMobileAgentActive(true);
      decrementAgentActive();
      expect(isMobileAgentActive()).toBe(false);
    });
  });
});
