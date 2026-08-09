/**
 * C-orch-1 单测专用 mock：desktop-runtime-singleton。
 * 不拉起真实 SQLite runtime，返回带 abortRegistry 占位的 fake runtime。
 */
const fakeRuntime = {
  abortRegistry: {
    has: () => false,
    abort: () => {},
    register: () => {},
    unregister: () => {},
  },
};

export async function getDesktopRuntime() {
  return fakeRuntime;
}

export function getDesktopRuntimeOrThrow() {
  return fakeRuntime;
}

export async function resetDesktopRuntimeForTest() {}

export async function rebootstrapDesktopRuntime() {
  return fakeRuntime;
}

export function clearDesktopRuntimeHandle() {}
