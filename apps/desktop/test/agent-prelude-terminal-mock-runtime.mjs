/**
 * r3-run-1/2 单测专用 mock：desktop-runtime-singleton。
 * 不拉起真实 SQLite runtime，返回带 abortRegistry 占位的 fake runtime。
 *
 * 契约对齐错误通道迁移七期：getDesktopRuntime / rebootstrapDesktopRuntime
 * 都返回 Result（`{ ok: true, value }`），与 desktop-runtime-singleton.ts
 * 的真实签名一致——handler 侧先判 built.ok 再取 built.value。
 */
const fakeRuntime = {
  abortRegistry: {
    has: () => false,
    abort: () => {},
    register: () => {},
    unregister: () => {},
  },
  // Agent 门面（spec §二）：handler 判活 / abort 走 `agentAbortRegistry`。
  agentAbortRegistry: {
    has: () => false,
    abort: () => {},
    register: () => {},
    tryRegister: () => true,
    unregister: () => {},
  },
};

export const DesktopRuntimeSingleton = {
  async get() {
    return { ok: true, value: fakeRuntime };
  },

  getOrThrow() {
    return fakeRuntime;
  },

  async resetForTest() {},

  async rebootstrap() {
    return { ok: true, value: fakeRuntime };
  },

  clearHandle() {},
};
