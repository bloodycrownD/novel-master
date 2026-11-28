/**
 * MCP 服务器详情页「发起授权」的编排用例（mcp-connect-model 开发期变更 4）：
 * oauthStart 处理器只做授权 + 作废旧缓存，不再自带后台连接；授权成功后界面自己
 * 再连一次（ipcMcpConnect）并回读状态——与详情页保存 → connectSaved 同口径。
 * 范式同 fetch-models-modal / search-engines-view：react-alias-hook 统一 react 副本，
 * react-test-renderer 真渲组件，IPC 拦在 window.novelMasterDesktop.invoke。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import TestRenderer, { type ReactTestRenderer, type TestInstance } from "react-test-renderer";
import type { ReactElement } from "react";
import { IPC_CHANNELS, type McpServerConfig, type McpServerStatus } from "@shared/ipc-types";
import type { SettingsNavHandle, SettingsViewId } from "@/features/settings/settings-nav";

register(new URL("./react-alias-hook.mjs", import.meta.url), import.meta.url);
const { act } = await import("react");
const { McpServerDetailView } = await import("@/features/settings/McpServerDetailView");
const { settingsTranslator } = await import("@/i18n/settings");

/** OAuth 服务器的配置 fixture（详情页编辑态；authType=oauth 才有「发起授权」区）。 */
const OAUTH_SERVER: McpServerConfig = { id: "a", description: "", enabled: true, transport: { type: "http", url: "https://a.example.com/mcp" }, timeoutMs: 120_000, auth: { type: "oauth" } };

/** 授权前「已断开」的状态 fixture。 */
const DISCONNECTED: McpServerStatus = { serverId: "a", state: "disconnected" };

type InvokeCall = { readonly channel: string; readonly payload: unknown };
type Invoke = (channel: string, payload: unknown) => Promise<unknown>;

/** 允许的 IPC 面：未知 channel 直接失败（防止 UI 打错通道被静默放过）。 */
const ALLOWED_CHANNELS = new Set<string>([IPC_CHANNELS.MCP_LIST_SERVERS, IPC_CHANNELS.MCP_SAVE_SERVER, IPC_CHANNELS.MCP_CONNECT, IPC_CHANNELS.MCP_SERVER_STATUSES, IPC_CHANNELS.MCP_TOOL_LIST, IPC_CHANNELS.MCP_OAUTH_START, IPC_CHANNELS.MCP_OAUTH_STATUSES]);

/** 按 channel 路由的 IPC 假实现（授权腿直接成功，connect 返回 ready）。 */
function makeInvoke(calls: InvokeCall[]): Invoke {
    return (channel, payload) => {
        calls.push({ channel, payload });
        if (!ALLOWED_CHANNELS.has(channel)) return Promise.reject(new Error(`测试未预期的 IPC channel: ${channel}`));
        if (channel === IPC_CHANNELS.MCP_LIST_SERVERS) return Promise.resolve({ ok: true, data: [OAUTH_SERVER] });
        if (channel === IPC_CHANNELS.MCP_SERVER_STATUSES) return Promise.resolve({ ok: true, data: [DISCONNECTED] });
        if (channel === IPC_CHANNELS.MCP_TOOL_LIST) return Promise.resolve({ ok: true, data: [] });
        if (channel === IPC_CHANNELS.MCP_OAUTH_STATUSES) return Promise.resolve({ ok: true, data: { a: true } });
        if (channel === IPC_CHANNELS.MCP_SAVE_SERVER) return Promise.resolve({ ok: true, data: { serverId: OAUTH_SERVER.id } });
        if (channel === IPC_CHANNELS.MCP_OAUTH_START) return Promise.resolve({ ok: true, data: { authorizeUrl: "https://auth.example.com/authorize" } });
        if (channel === IPC_CHANNELS.MCP_CONNECT) return Promise.resolve({ ok: true, data: { ...DISCONNECTED, state: "ready", toolCount: 2 } });
        return Promise.resolve({ ok: true, data: undefined });
    };
}

/** 挂全局 window.novelMasterDesktop，返回还原函数。 */
function mockWindow(invoke: Invoke): () => void {
    const g = globalThis as unknown as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevWindow = g.window;
    const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
    g.window = { novelMasterDesktop: { invoke } };
    g.IS_REACT_ACT_ENVIRONMENT = true;
    return () => {
        g.window = prevWindow;
        g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    };
}

type NavFixture = { readonly handle: SettingsNavHandle; readonly state: { editingMcpServerId?: string } };

/** nav fixture：navState 为可变普通对象（详情页据此定位 server，保存后写回真 id）。 */
function makeNav(editingMcpServerId: string): NavFixture {
    const state: { editingMcpServerId?: string } = { editingMcpServerId };
    return { handle: { push: () => undefined, pop: () => undefined, navState: state, dirtyViews: new Set<SettingsViewId>() }, state };
}

/** 递归收集节点文本（host 节点 children 为字符串或嵌套节点）。 */
function textOf(node: TestInstance): string {
    let out = "";
    for (const child of node.children ?? []) {
        out += typeof child === "string" ? child : textOf(child);
    }
    return out;
}

function findButtonByText(root: TestInstance, text: string): TestInstance | undefined {
    return root.findAll((node) => node.type === "button" && textOf(node).trim() === text).at(0);
}

/** 调节点上的事件处理器。 */
function invokeProp(node: TestInstance, name: string, ...args: unknown[]): void {
    const handler = node.props[name];
    assert.equal(typeof handler, "function", `节点缺少 ${name} 处理器`);
    (handler as (...rest: unknown[]) => void)(...args);
}

/** 等几轮宏任务，让 act 内的 IPC promise 链与 setState 全部落定。 */
async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

/** 挂载并等首轮读库（effect → reload）落定。 */
async function mount(element: ReactElement): Promise<ReactTestRenderer> {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
        renderer = TestRenderer.create(element);
    });
    await settle();
    if (renderer == null) throw new Error("渲染失败");
    return renderer;
}

function callsOf(calls: readonly InvokeCall[], channel: string): InvokeCall[] {
    return calls.filter((call) => call.channel === channel);
}

let restoreWindow: (() => void) | undefined;
let mounted: ReactTestRenderer[] = [];

beforeEach(() => {
    mounted = [];
});

afterEach(async () => {
    // 卸载也会触发 effect 清理与 setState，放进 act 内避免 act 警告
    await act(async () => {
        for (const renderer of mounted) renderer.unmount();
    });
    restoreWindow?.();
    restoreWindow = undefined;
});

describe("MCP 服务器详情页 · 发起授权的连接编排", () => {
    it("授权成功后界面连一次：oauthStart 成功返回才发 connect，且连的是授权的同一 server", async () => {
        const calls: InvokeCall[] = [];
        restoreWindow = mockWindow(makeInvoke(calls));
        const nav = makeNav("a");
        const renderer = await mount(<McpServerDetailView nav={nav.handle} />);
        mounted.push(renderer);
        const authorizeButton = findButtonByText(renderer.root, settingsTranslator({ key: "settings.mcp.detail.reauthorize.desktop" }));
        assert.ok(authorizeButton != null, "OAuth 区缺少「发起授权」按钮");
        await act(async () => {
            invokeProp(authorizeButton as TestInstance, "onClick");
        });
        await settle();
        const starts = callsOf(calls, IPC_CHANNELS.MCP_OAUTH_START);
        const connects = callsOf(calls, IPC_CHANNELS.MCP_CONNECT);
        assert.equal(starts.length, 1, "oauthStart 只调一次");
        assert.deepEqual(starts[0]?.payload, { serverId: "a" }, "授权对象是当前 server");
        assert.equal(connects.length, 1, "授权成功后界面连一次");
        assert.deepEqual(connects[0]?.payload, { serverId: "a" }, "连接对象是授权的同一 server");
        assert.ok(calls.indexOf(connects[0] as InvokeCall) > calls.indexOf(starts[0] as InvokeCall), "connect 必须发生在 oauthStart 成功返回之后");
    });
});
