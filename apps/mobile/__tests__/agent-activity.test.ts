import {readFileSync} from 'fs';
import {join} from 'path';
import {
  decrementAgentActive,
  incrementAgentActive,
  isMobileAgentActive,
  setMobileAgentActive,
  subscribeMobileAgentActivity,
} from '@/runtime/agent-activity';
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  SimpleEventBus,
} from '@novel-master/core/events';
import {SessionStreamUnitManager} from '@/services/session-stream-unit-manager.service';

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

  // T-P7 守卫的前置：refcount 的增减放完全由 SessionStreamUnitManager 独占
  // （原 AgentRunManager 的契约原样吸收），生命周期（受理/事件收尾/finally
  // 早退）任一环节都不得漏发或双发。
  describe('T-P7 守卫：refcount 单一归属（Manager 是唯一触发方）', () => {
    function createManagerHarness() {
      const eventBus = new SimpleEventBus();
      const abortRegistry = {
        has: jest.fn((_sessionId: string) => false),
        abort: jest.fn(),
        register: jest.fn(),
        unregister: jest.fn(),
      };
      const sessions = {
        get: jest.fn(async (sessionId: string) => ({
          id: sessionId,
          title: `会话-${sessionId}`,
        })),
      };
      const projects = {
        get: jest.fn(async (projectId: string) => ({
          id: projectId,
          name: `项目-${projectId}`,
        })),
      };
      const runAgentTurn = jest.fn(
        async () => new Promise<void>(() => undefined), // 挂起，终态由测试驱动事件模拟
      );
      const manager = new SessionStreamUnitManager({
        runtime: {eventBus, abortRegistry, sessions, projects} as never,
        runAgentTurn: runAgentTurn as never,
      });
      manager.markHydrated();
      return {eventBus, runAgentTurn, manager};
    }

    /** 等待 fire-and-forget promise 链（catch+finally）收敛。 */
    async function flushAsync(): Promise<void> {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    afterEach(() => {
      setMobileAgentActive(false);
    });

    it('受理即活跃；FINISHED 事件收尾后归零', () => {
      const h = createManagerHarness();
      try {
        expect(h.manager.startRun('a', 'p', 'hi').ok).toBe(true);
        // 受理路径同步 increment——RUN_STARTED 之前守卫就必须生效
        expect(isMobileAgentActive()).toBe(true);

        h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
          sessionId: 'a',
          projectId: 'p',
          runId: 'r1',
        });
        expect(isMobileAgentActive()).toBe(true); // STARTED 不碰 refcount

        h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
          sessionId: 'a',
          projectId: 'p',
          runId: 'r1',
          stopReason: 'done',
        });
        expect(isMobileAgentActive()).toBe(false);
      } finally {
        h.manager.dispose();
      }
    });

    it('FAILED 事件收尾后同样归零（备份/云同步守卫随之解除）', () => {
      const h = createManagerHarness();
      try {
        h.manager.startRun('a', 'p', 'hi');
        h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
          sessionId: 'a',
          projectId: 'p',
          runId: 'r1',
        });
        h.eventBus.publish(EVENT_AGENT_RUN_FAILED, {
          sessionId: 'a',
          projectId: 'p',
          runId: 'r1',
          error: 'boom',
        });
        expect(isMobileAgentActive()).toBe(false);
      } finally {
        h.manager.dispose();
      }
    });

    it('RUN_STARTED 未达即抛错时 finally 早退也归零', async () => {
      const h = createManagerHarness();
      h.runAgentTurn.mockRejectedValue(new Error('early boom'));
      try {
        h.manager.startRun('a', 'p', 'hi');
        expect(isMobileAgentActive()).toBe(true);

        await flushAsync();
        expect(isMobileAgentActive()).toBe(false);
        // finally 兜底直接销毁单元出表（snapshot 归 null）
        expect(h.manager.snapshot('a')).toBe(null);
      } finally {
        h.manager.dispose();
      }
    });

    it('跨会话并行时归零发生在最后一个 run 收尾（守卫覆盖整个活跃窗口）', () => {
      const h = createManagerHarness();
      try {
        h.manager.startRun('a', 'p', '1');
        h.manager.startRun('b', 'p', '2');
        expect(isMobileAgentActive()).toBe(true);

        h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
          sessionId: 'a',
          projectId: 'p',
          runId: 'r1',
        });
        h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
          sessionId: 'b',
          projectId: 'p',
          runId: 'r2',
        });

        h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
          sessionId: 'a',
          projectId: 'p',
          runId: 'r1',
          stopReason: 'done',
        });
        // A 结束但 B 仍在跑：备份/云同步仍须被拦
        expect(isMobileAgentActive()).toBe(true);

        h.eventBus.publish(EVENT_AGENT_RUN_FAILED, {
          sessionId: 'b',
          projectId: 'p',
          runId: 'r2',
          error: 'boom',
        });
        expect(isMobileAgentActive()).toBe(false);
      } finally {
        h.manager.dispose();
      }
    });

    it('渲染层/单元不碰 refcount（静态约束：源码不含计数 API）', () => {
      // 单一归属的可执行锁定：屏幕组合层与消息 hook、单元本体都不得引入
      // increment/decrement/setMobileAgentActive——计数只能由 Manager 的
      // 受理/事件/finally 三条路径改动（Step 7 起旧 hook 已删，清单换成
      // 现存的等价消费面）。
      const lifecycleSources = [
        join(__dirname, '../src/screens/tabs/chat-tab/ChatTabProvider.tsx'),
        join(__dirname, '../src/screens/tabs/chat-tab/useChatTabMessages.ts'),
        join(__dirname, '../src/services/session-stream-unit.ts'),
      ];
      for (const sourcePath of lifecycleSources) {
        const source = readFileSync(sourcePath, 'utf8');
        // 匹配「调用或具名导入」形状；只读视图（isMobileAgentActive /
        // subscribeMobileAgentActivity）与注释里的提及不算碰计数。
        expect(source).not.toMatch(
          /\b(?:incrementAgentActive|decrementAgentActive|setMobileAgentActive)\s*\(|import\s*\{[^}]*\b(?:incrementAgentActive|decrementAgentActive|setMobileAgentActive)\b/,
        );
      }
    });
  });
});
