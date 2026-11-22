/**
 * CloudSyncProgressScreen 取消入口（signal-abort-scope Step 14）。
 *
 * 断言三件事：进度中「取消」按钮存在、点击派发
 * `runtime.abortRegistry.abort(ABORT_KEY.cloudSync('local'))`、取消后进度进
 * `*_cancelled` 终态且按钮消失、不弹错误 toast、不自动返回。
 *
 * 照 chat-config-screen-switch.test.tsx 的 TestRenderer 直测风格：service 换
 * 可控 promise（保留 reject 出口模拟 AbortError），面板 mock 成可读 state 的
 * 节点，避免 Animated 干扰断言。
 */
import React from 'react';
import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {ABORT_KEY, AbortError} from '@novel-master/core/abort';
import {SecondaryButton} from '@/components/ui/Buttons';
import {CloudSyncProgressScreen} from '@/screens/stack/CloudSyncProgressScreen';

const mockShowToast = jest.fn();
const mockGoBack = jest.fn();
const mockReplace = jest.fn();
const mockAbort = jest.fn();
const mockRetryAndWait = jest.fn();
const mockSetStackOverride = jest.fn();
// 与真实 context 同款：runtime / navigation 必须是稳定引用，否则 effect
// 依赖（runtime、handleNeedPullFirst）每次渲染都变，setState 会把渲染打循环。
const mockRuntime = {abortRegistry: {abort: mockAbort}};
const mockNavigation = {goBack: mockGoBack, replace: mockReplace};
const mockNovelMaster = {retryAndWait: mockRetryAndWait};
let mockOp: 'pull' | 'push' = 'pull';
let mockRejectRun: ((error: unknown) => void) | undefined;

jest.mock('@/theme/ThemeProvider', () => ({
    useTheme: () => ({
        tokens: {
            background: '#fff',
            surface: '#f5f5f5',
            text: '#111',
            textSecondary: '#666',
            textTertiary: '#999',
            border: '#ddd',
            borderLight: '#eee',
            bgSecondary: '#eee',
            primary: '#007aff',
            danger: '#f00',
        },
    }),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
    useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/hooks/useRuntime', () => ({
    useRuntime: () => mockRuntime,
}));

jest.mock('@/runtime/novel-master-context', () => ({
    useNovelMaster: () => mockNovelMaster,
}));

jest.mock('@/navigation/HeaderContext', () => ({
    useStackOverrideSetter: () => mockSetStackOverride,
}));

jest.mock('@react-navigation/native', () => ({
    useFocusEffect: () => undefined,
    useNavigation: () => mockNavigation,
    useRoute: () => ({params: {op: mockOp}}),
}));

jest.mock('@/components/chrome/CloudSyncProgressPanel', () => {
    const mockReact = require('react');
    return {
        CloudSyncProgressPanel: (props: {title: string; state: unknown}) =>
            mockReact.createElement('View', {
                testID: 'cloud-sync-progress-panel',
                title: props.title,
                state: props.state,
            }),
    };
});

jest.mock('@/services/cloud-sync.service', () => {
    const legacy = {
    initialCloudSyncProgressUi: (op: 'pull' | 'push') => ({
        op,
        event: 'start',
        label: op === 'pull' ? '准备拉取…' : '准备推送…',
        progress: 0.02,
    }),
    // 可控挂起：测试里只保留 reject 出口，模拟 service 边界原样上抛 AbortError。
    pullCloudSync: (..._args: unknown[]) =>
        new Promise<never>((_resolve, reject) => {
            mockRejectRun = reject;
        }),
    pushCloudSync: (..._args: unknown[]) =>
        new Promise<never>((_resolve, reject) => {
            mockRejectRun = reject;
        }),
};
    return {...legacy, CloudSyncService: {pull: legacy.pullCloudSync, push: legacy.pushCloudSync}};
});

beforeEach(() => {
    jest.clearAllMocks();
    mockOp = 'pull';
    mockRejectRun = undefined;
});

function renderScreen(): TestRenderer.ReactTestRenderer {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
        renderer = TestRenderer.create(<CloudSyncProgressScreen />);
    });
    return renderer;
}

describe('CloudSyncProgressScreen 取消入口 — Step 14', () => {
    it('进度中显示取消按钮，点击调 abortRegistry.abort(cloudSync("local"))', () => {
        const renderer = renderScreen();
        const buttons = renderer.root.findAllByType(SecondaryButton);
        expect(buttons).toHaveLength(1);
        expect(buttons[0]!.props.label).toBe('取消');

        act(() => {
            buttons[0]!.props.onPress();
        });

        expect(mockAbort).toHaveBeenCalledTimes(1);
        expect(mockAbort).toHaveBeenCalledWith(ABORT_KEY.cloudSync('local'));
    });

    it('取消后进度进 pull_cancelled 终态、按钮消失、不弹错误提示、不自动返回', async () => {
        const renderer = renderScreen();
        const onPress = renderer.root.findByType(SecondaryButton).props.onPress as () => void;

        await act(async () => {
            onPress();
            mockRejectRun?.(AbortError.create());
            await Promise.resolve();
            await Promise.resolve();
        });

        const panel = renderer.root.findByProps({
            testID: 'cloud-sync-progress-panel',
        });
        expect(panel.props.state).toMatchObject({
            op: 'pull',
            event: 'pull_cancelled',
            label: '拉取已取消',
            progress: 1,
        });
        expect(renderer.root.findAllByType(SecondaryButton)).toHaveLength(0);
        expect(mockShowToast).not.toHaveBeenCalled();
        expect(mockGoBack).not.toHaveBeenCalled();
    });

    it('push 取消进入 push_cancelled 终态，同样静默收尾', async () => {
        mockOp = 'push';
        const renderer = renderScreen();
        const onPress = renderer.root.findByType(SecondaryButton).props.onPress as () => void;

        await act(async () => {
            onPress();
            mockRejectRun?.(AbortError.create());
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockAbort).toHaveBeenCalledWith(ABORT_KEY.cloudSync('local'));
        const panel = renderer.root.findByProps({
            testID: 'cloud-sync-progress-panel',
        });
        expect(panel.props.state).toMatchObject({
            op: 'push',
            event: 'push_cancelled',
            label: '推送已取消',
            progress: 1,
        });
        expect(renderer.root.findAllByType(SecondaryButton)).toHaveLength(0);
        expect(mockShowToast).not.toHaveBeenCalled();
        expect(mockGoBack).not.toHaveBeenCalled();
    });

    it('取消按钮文案走 settings.long_task.cancel descriptor（双端共享同一 key）', () => {
        const source = readFileSync(join(__dirname, '../src/screens/stack/CloudSyncProgressScreen.tsx'), 'utf8');
        expect(source).toMatch(/settingsTranslator\(\{key: 'settings\.long_task\.cancel'\}\)/);
    });
});
