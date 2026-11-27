/**
 * McpServersScreen 的进页连接轮（T-MO6）：
 *
 * - 进入列表页只发起一轮 connectUnconnected（focus 触发）；重读状态后不再次
 *   发起，即使有服务器仍是已断开（防「状态更新 → 重读 → 再发起」循环）
 * - 发起后立即重读一次、连接轮结束后再重读一次（fetcher 共执行三次）
 * - 再次进入（focus）与下拉刷新都按重新进入处理，会再发起一轮
 *
 * mock 面：useFocusEffect 按槽位登记回调、由测试手动触发（无 navigation
 * container）；runtime 只给屏幕消费的 mcp 切片窄面；RN 组件走 jest preset。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Result} from '@novel-master/core/errors';
import type {McpServerConfig, McpServerStatus} from '@novel-master/core/mcp';

/** 每个 useFocusEffect 调用点占一槽（React hooks 调用序稳定），存最新回调，由测试手动触发。 */
const mockFocusEffectSlots: Array<(() => void) | undefined> = [];

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@react-navigation/native', () => ({
    useFocusEffect: (callback: () => void) => {
        const React = require('react');
        const slotRef = React.useRef(-1);
        if (slotRef.current === -1) {
            slotRef.current = mockFocusEffectSlots.length;
            mockFocusEffectSlots.push(undefined);
        }
        mockFocusEffectSlots[slotRef.current] = callback;
    },
    useNavigation: () => ({navigate: jest.fn(), goBack: jest.fn()}),
    // AppModal（ModalShell 内部）读焦点态：测试环境恒聚焦。
    useIsFocused: () => true,
}));

const mockSetStackOverride = jest.fn();
jest.mock('@/navigation/HeaderContext', () => ({
    useStackOverrideSetter: () => mockSetStackOverride,
}));

const mockShowToast = jest.fn();
jest.mock('@/components/chrome/ToastHost', () => ({
    useToast: () => ({showToast: mockShowToast}),
}));

const mockTokens = {
    background: '#fff',
    bgSecondary: '#eee',
    surface: '#f8f8f8',
    text: '#111',
    textSecondary: '#666',
    border: '#ccc',
    borderLight: '#e0e0e0',
    primary: '#007aff',
    success: '#34c759',
    danger: '#ff3b30',
};
jest.mock('@/theme/ThemeProvider', () => ({
    useTheme: () => ({tokens: mockTokens}),
}));

const mockServers: McpServerConfig[] = [];
const mockStatuses: McpServerStatus[] = [];
const mockConnectUnconnected = jest.fn(async () => undefined);
const mockMcp = {
    reload: jest.fn(async () => Result.ok(mockServers)),
    servers: jest.fn(() => mockServers),
    connectionManager: {
        connectUnconnected: mockConnectUnconnected,
        connect: jest.fn(async (serverId: string) => ({serverId, state: 'ready' as const})),
        serverStatuses: jest.fn(() => mockStatuses),
    },
    setEnabled: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    setToolDisabled: jest.fn(async () => undefined),
    disabledTools: jest.fn(() => []),
};
const mockRuntime = {mcp: mockMcp};
jest.mock('@/hooks/useRuntime', () => ({
    useRuntime: () => mockRuntime,
}));

import {McpServersScreen} from '@/screens/stack/McpServersScreen';

function serverConfig(id: string): McpServerConfig {
    return {id, description: '', enabled: true, transport: {type: 'http', url: `https://${id}.example.com/mcp`}, timeoutMs: 120000, auth: {type: 'none'}};
}

function renderScreen(): TestRenderer.ReactTestRenderer {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
        renderer = TestRenderer.create(<McpServersScreen />);
    });
    return renderer;
}

/** 手动触发全部 focus 回调（模拟进入列表页）。 */
function fireFocus(): void {
    act(() => {
        for (const effect of mockFocusEffectSlots) {
            if (effect != null) effect();
        }
    });
}

/** 排空微任务（fetcher / 连接轮的 then 链落地）。 */
async function flushMicrotasks(rounds = 10): Promise<void> {
    await act(async () => {
        for (let i = 0; i < rounds; i++) {
            await Promise.resolve();
        }
    });
}

describe('McpServersScreen 进页连接轮（T-MO6）', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFocusEffectSlots.length = 0;
        mockServers.length = 0;
        mockStatuses.length = 0;
    });

    it('进入一次只发起一轮 connectUnconnected；重读后（已断开服务器仍已断开）不再次发起', async () => {
        mockServers.push(serverConfig('a'), serverConfig('b'));
        mockStatuses.push({serverId: 'a', state: 'ready'}, {serverId: 'b', state: 'disconnected'});
        renderScreen();

        fireFocus();
        await flushMicrotasks();

        expect(mockConnectUnconnected).toHaveBeenCalledTimes(1);
        // 重读链落地：立即重读 + 结束后再重读（fetcher 共三次——focus 重载 + 两轮静默重读）。
        expect(mockMcp.reload).toHaveBeenCalledTimes(3);
        // 再排空一轮微任务（模拟任何后续状态更新），仍只有一轮。
        await flushMicrotasks();
        expect(mockConnectUnconnected).toHaveBeenCalledTimes(1);
    });

    it('再次进入（focus）按重新进入处理，会再发起一轮', async () => {
        mockServers.push(serverConfig('a'));
        mockStatuses.push({serverId: 'a', state: 'disconnected'});
        renderScreen();

        fireFocus();
        await flushMicrotasks();
        expect(mockConnectUnconnected).toHaveBeenCalledTimes(1);

        fireFocus();
        await flushMicrotasks();
        expect(mockConnectUnconnected).toHaveBeenCalledTimes(2);
    });

    it('下拉刷新按重新进入处理：onRefresh 重置进页标志并再发起一轮', async () => {
        mockServers.push(serverConfig('a'));
        mockStatuses.push({serverId: 'a', state: 'disconnected'});
        const renderer = renderScreen();

        fireFocus();
        await flushMicrotasks();
        expect(mockConnectUnconnected).toHaveBeenCalledTimes(1);

        const refreshControls = renderer.root.findAll(
            (node: {props?: {onRefresh?: unknown; refreshing?: unknown}}) => node.props != null && node.props.onRefresh != null && node.props.refreshing != null,
        );
        expect(refreshControls.length).toBeGreaterThanOrEqual(1);
        await act(async () => {
            await refreshControls[0].props.onRefresh();
        });
        await flushMicrotasks();
        expect(mockConnectUnconnected).toHaveBeenCalledTimes(2);
    });
});
