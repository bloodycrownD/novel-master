/**
 * 桌面设置页长任务取消入口（signal-abort-scope Step 14 / T-S22 UI 侧）：
 *
 * - 备份导出 / 导入、云同步推送：运行中出现**可用**的「取消」，点击发
 *   `nm:run/abort`。backup 用 renderer 生成并随请求下发的 runId；云同步的
 *   main 侧 key 固定 `sync:local`（pull/push 全局互斥），故取消 id 为 "local"。
 * - 数据清理：取消按钮**禁用** + 「正在整理，无法中断」文案，点击不产生 abort
 *   请求（VACUUM / checkpoint 同步段不可中断）。
 * - `IPC_ABORTED` 是取消终态：不弹错误 toast、按钮回到可重试态。
 *
 * 行为范式同 fetch-models-modal.test.tsx：react-alias-hook 统一 react 副本，
 * react-test-renderer 真渲组件；NovelMasterProvider 由解析钩子换成 `{ retry }`
 * 替身；IPC 拦在 window.novelMasterDesktop.invoke。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import TestRenderer, { type ReactTestRenderer, type TestInstance } from "react-test-renderer";
import { IPC_CHANNELS } from "@shared/ipc-types";

register(new URL("./react-alias-hook.mjs", import.meta.url));
register(new URL("./settings-data-management-hook.mjs", import.meta.url));
const { act } = await import("react");
const { DataManagementView } = await import("@/features/settings/SettingsViews");
const { subscribeToast } = await import("@/components/ui/show-toast");

type InvokeCall = { readonly channel: string; readonly payload: unknown };
type Invoke = (channel: string, payload: unknown) => Promise<unknown>;

const BASE_CONFIG = {
  endpoint: "https://s3.example.com",
  bucket: "nm",
  region: "",
  pathPrefix: "novel-master/sync/",
  accessKeyId: "ak",
  forcePathStyle: true,
  deviceId: "device-1",
  deviceLabel: "desktop",
  hasSecretKey: true,
  enabled: true,
};

const BASE_STATUS = {
  configured: true,
  lastSyncedRev: 3,
  remoteRev: 3,
  suggestsPull: false,
  syncBusy: false,
  agentActive: false,
  maintenanceBusy: false,
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 基础 IPC 路由；长任务通道由各用例用 overrides 换成未决 promise。 */
function makeBridge(overrides: Readonly<Record<string, Invoke>> = {}) {
  const calls: InvokeCall[] = [];
  const invoke: Invoke = (channel, payload) => {
    calls.push({ channel, payload });
    const override = overrides[channel];
    if (override != null) {
      return override(channel, payload);
    }
    switch (channel) {
      case IPC_CHANNELS.CLOUD_SYNC_GET_CONFIG:
        return Promise.resolve({ ok: true, data: BASE_CONFIG });
      case IPC_CHANNELS.CLOUD_SYNC_GET_LOCAL_STATUS:
        return Promise.resolve({ ok: true, data: BASE_STATUS });
      case IPC_CHANNELS.DB_STATS:
        return Promise.resolve({ ok: true, data: { fileBytes: 4096, reclaimableBytes: 1024 } });
      default:
        return Promise.resolve({ ok: true, data: undefined });
    }
  };
  return { calls, invoke };
}

type Mounted = {
  renderer: ReactTestRenderer;
  restore: () => void;
};

async function mount(invoke: Invoke): Promise<Mounted> {
  const g = globalThis as unknown as {
    window?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const prevWindow = g.window;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  g.window = {
    novelMasterDesktop: { invoke },
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<DataManagementView />);
  });
  if (renderer == null) {
    throw new Error("渲染失败");
  }
  return {
    renderer,
    restore: () => {
      g.window = prevWindow;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    },
  };
}

/** 等待 act 内的异步状态更新（promise continuation / 轮询回读）。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

/** 按「子节点恰好是该文案」定位 Button 渲染出的 button。 */
function buttonByText(root: TestInstance, text: string): TestInstance | undefined {
  return root.findAll((node) => node.type === "button" && (node.children as unknown[]).some((child) => typeof child === "string" && child.trim() === text))[0];
}

function requireButton(root: TestInstance, text: string): TestInstance {
  const button = buttonByText(root, text);
  assert.ok(button != null, `未找到按钮：${text}`);
  return button;
}

function cancelButton(root: TestInstance): TestInstance | undefined {
  return root.findAll((node) => node.type === "button" && typeof node.props.className === "string" && node.props.className.includes("settings-long-task-cancel"))[0];
}

async function click(node: TestInstance): Promise<void> {
  await act(async () => {
    (node as unknown as { props: { onClick: () => void } }).props.onClick();
  });
}

/** 收集取消流程中的 toast，结束后退订。 */
function collectToasts(): { toasts: string[]; stop: () => void } {
  const toasts: string[] = [];
  const unsubscribe = subscribeToast((state) => {
    if (state != null) {
      toasts.push(state.message);
    }
  });
  return { toasts, stop: unsubscribe };
}

describe("设置页长任务取消入口（Step 14）", () => {
  it("备份导出：运行中可用取消，发 {kind:'backup', id:runId}；IPC_ABORTED 不弹错误 toast", async () => {
    const gate = deferred<unknown>();
    const { calls, invoke } = makeBridge({
      [IPC_CHANNELS.BACKUP_EXPORT]: () => gate.promise,
      [IPC_CHANNELS.NM_RUN_ABORT]: () => Promise.resolve({ ok: true, data: null }),
    });
    const toast = collectToasts();
    const mounted = await mount(invoke);
    try {
      await click(requireButton(mounted.renderer.root, "导出数据库"));
      const exportCall = calls.find((call) => call.channel === IPC_CHANNELS.BACKUP_EXPORT);
      assert.ok(exportCall != null, "导出未发 IPC");
      const runId = (exportCall.payload as { runId?: string }).runId;
      assert.match(runId ?? "", /^[0-9a-f-]{36}$/i, "runId 应为 renderer 生成的 uuid");

      const cancel = cancelButton(mounted.renderer.root);
      assert.ok(cancel != null, "导出运行中应出现取消按钮");
      assert.equal(cancel.props.disabled, false);
      await click(cancel);

      const abortCall = calls.find((call) => call.channel === IPC_CHANNELS.NM_RUN_ABORT);
      assert.deepEqual(abortCall?.payload, { kind: "backup", id: runId });

      await act(async () => {
        gate.resolve({ ok: false, error: { code: "IPC_ABORTED", message: "已取消" } });
      });
      await settle();
      assert.equal(cancelButton(mounted.renderer.root), undefined, "取消终态应收起取消按钮");
      assert.equal(requireButton(mounted.renderer.root, "导出数据库").props.disabled, false);
      assert.deepEqual(toast.toasts, [], "取消终态不应弹任何错误 toast");
    } finally {
      toast.stop();
      await act(async () => mounted.renderer.unmount());
      mounted.restore();
    }
  });

  it("备份导入：确认后运行中可用取消，发 {kind:'backup', id:runId}", async () => {
    const gate = deferred<unknown>();
    const { calls, invoke } = makeBridge({
      [IPC_CHANNELS.BACKUP_IMPORT]: () => gate.promise,
      [IPC_CHANNELS.NM_RUN_ABORT]: () => Promise.resolve({ ok: true, data: null }),
    });
    const toast = collectToasts();
    const mounted = await mount(invoke);
    try {
      await click(requireButton(mounted.renderer.root, "导入数据库"));
      await click(requireButton(mounted.renderer.root, "确定"));

      const importCall = calls.find((call) => call.channel === IPC_CHANNELS.BACKUP_IMPORT);
      assert.ok(importCall != null, "导入未发 IPC");
      const runId = (importCall.payload as { runId?: string }).runId;
      assert.match(runId ?? "", /^[0-9a-f-]{36}$/i, "runId 应为 renderer 生成的 uuid");

      const cancel = cancelButton(mounted.renderer.root);
      assert.ok(cancel != null, "导入运行中应出现取消按钮");
      await click(cancel);

      const abortCall = calls.find((call) => call.channel === IPC_CHANNELS.NM_RUN_ABORT);
      assert.deepEqual(abortCall?.payload, { kind: "backup", id: runId });

      await act(async () => {
        gate.resolve({ ok: false, error: { code: "IPC_ABORTED", message: "已取消" } });
      });
      await settle();
      assert.equal(cancelButton(mounted.renderer.root), undefined);
      assert.deepEqual(toast.toasts, [], "取消终态不应弹任何错误 toast");
    } finally {
      toast.stop();
      await act(async () => mounted.renderer.unmount());
      mounted.restore();
    }
  });

  it("云同步推送：运行中可用取消，发 {kind:'sync', id:'local'}", async () => {
    const gate = deferred<unknown>();
    const { calls, invoke } = makeBridge({
      [IPC_CHANNELS.CLOUD_SYNC_PUSH]: () => gate.promise,
      [IPC_CHANNELS.NM_RUN_ABORT]: () => Promise.resolve({ ok: true, data: null }),
    });
    const toast = collectToasts();
    const mounted = await mount(invoke);
    try {
      await click(requireButton(mounted.renderer.root, "推送到云端"));

      const pushCall = calls.find((call) => call.channel === IPC_CHANNELS.CLOUD_SYNC_PUSH);
      assert.ok(pushCall != null, "推送未发 IPC");
      const pushRequest = pushCall.payload as { runId?: string; forceOverwriteRemote?: boolean };
      assert.match(pushRequest.runId ?? "", /^[0-9a-f-]{36}$/i, "推送请求应带 renderer 生成的 runId");
      assert.equal(pushRequest.forceOverwriteRemote, undefined);

      const cancel = cancelButton(mounted.renderer.root);
      assert.ok(cancel != null, "推送运行中应出现取消按钮");
      await click(cancel);

      const abortCall = calls.find((call) => call.channel === IPC_CHANNELS.NM_RUN_ABORT);
      assert.deepEqual(abortCall?.payload, { kind: "sync", id: "local" });

      await act(async () => {
        gate.resolve({ ok: false, error: { code: "IPC_ABORTED", message: "已取消" } });
      });
      await settle();
      assert.equal(cancelButton(mounted.renderer.root), undefined);
      assert.deepEqual(toast.toasts, [], "取消终态不应弹任何错误 toast");
    } finally {
      toast.stop();
      await act(async () => mounted.renderer.unmount());
      mounted.restore();
    }
  });

  it("云同步拉取：确认后运行中可用取消，发 {kind:'sync', id:'local'}，IPC_ABORTED 不弹错误 toast", async () => {
    const gate = deferred<unknown>();
    const { calls, invoke } = makeBridge({
      [IPC_CHANNELS.CLOUD_SYNC_PULL]: () => gate.promise,
      [IPC_CHANNELS.NM_RUN_ABORT]: () => Promise.resolve({ ok: true, data: null }),
    });
    const toast = collectToasts();
    const mounted = await mount(invoke);
    try {
      await click(requireButton(mounted.renderer.root, "从云端拉取"));
      await click(requireButton(mounted.renderer.root, "确定"));

      const pullCall = calls.find((call) => call.channel === IPC_CHANNELS.CLOUD_SYNC_PULL);
      assert.ok(pullCall != null, "拉取未发 IPC");

      const cancel = cancelButton(mounted.renderer.root);
      assert.ok(cancel != null, "拉取运行中应出现取消按钮");
      await click(cancel);

      const abortCall = calls.find((call) => call.channel === IPC_CHANNELS.NM_RUN_ABORT);
      assert.deepEqual(abortCall?.payload, { kind: "sync", id: "local" });

      await act(async () => {
        gate.resolve({ ok: false, error: { code: "IPC_ABORTED", message: "已取消" } });
      });
      await settle();
      assert.equal(cancelButton(mounted.renderer.root), undefined);
      assert.deepEqual(toast.toasts, [], "取消终态不应弹任何错误 toast");
    } finally {
      toast.stop();
      await act(async () => mounted.renderer.unmount());
      mounted.restore();
    }
  });

  it("数据清理：取消按钮禁用 + 「正在整理，无法中断」，点击不发 abort", async () => {
    const gate = deferred<unknown>();
    const { calls, invoke } = makeBridge({
      [IPC_CHANNELS.DB_MAINTENANCE]: () => gate.promise,
      [IPC_CHANNELS.NM_RUN_ABORT]: () => Promise.resolve({ ok: true, data: null }),
    });
    const mounted = await mount(invoke);
    try {
      // 清理按钮文案随波 3c-a 裁决接 ui.storage.cleanup_action（清理→清理数据库空间），点击意图不变。
      await click(requireButton(mounted.renderer.root, "清理数据库空间"));
      await click(requireButton(mounted.renderer.root, "确定"));

      const maintenanceCall = calls.find((call) => call.channel === IPC_CHANNELS.DB_MAINTENANCE);
      assert.ok(maintenanceCall != null, "数据清理未发 IPC");
      const runId = (maintenanceCall.payload as { runId?: string }).runId;
      assert.match(runId ?? "", /^[0-9a-f-]{36}$/i, "runId 应为 renderer 生成的 uuid");

      const cancel = cancelButton(mounted.renderer.root);
      assert.ok(cancel != null, "数据清理运行中应出现取消按钮（禁用态）");
      assert.equal(cancel.props.disabled, true, "VACUUM 不可中断：取消按钮必须禁用");
      const hint = mounted.renderer.root.findAll((node) => typeof node.props.className === "string" && node.props.className.includes("settings-long-task-hint"))[0];
      assert.ok(hint != null, "缺少不可中断文案");
      assert.equal((hint.children as unknown[]).map((child) => String(child)).join(""), "正在整理，无法中断");

      // 禁用按钮不接线业务取消：没有 onClick 入口，也就不会产生 abort 请求。
      assert.equal(typeof cancel.props.onClick, "undefined");
      assert.equal(calls.filter((call) => call.channel === IPC_CHANNELS.NM_RUN_ABORT).length, 0);

      await act(async () => {
        gate.resolve({ ok: true, data: { beforeBytes: 4096, afterBytes: 2048 } });
      });
      await settle();
      assert.equal(cancelButton(mounted.renderer.root), undefined);
    } finally {
      await act(async () => mounted.renderer.unmount());
      mounted.restore();
    }
  });
});
