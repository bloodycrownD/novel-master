/**
 * AgentEditorForm → ToolPolicyPicker 的 MCP 快照接线（spec §九移动端口径）：
 * 页面打开时刻 runtime.mcp.connectionManager.snapshotTools() 读一次缓存，
 * 经 McpToolSlug.toolName 映射成注册名窄视图传 mcpTools prop；快照读取失败
 * 静默回落空数组（picker 侧 catalog 对空快照组装「未配置 MCP 服务器」占位）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Result} from '@novel-master/core/errors';

const mockGetRawWire = jest.fn();
const mockSnapshotTools = jest.fn();
// showToast 必须是模块级单例：AgentEditorForm 的 loadAgent effect deps 含 showToast，
// 每帧新引用会让 effect 无限重跑（render → setState → render），测试直接超时。
const mockShowToast = jest.fn();

// allow 模式让 AgentEditorToolsSection 渲染 ToolPolicyPicker（default 模式不渲染选择器）。
const wireWithAllowPolicy = {
    schemaVersion: 1,
    name: '写作助手',
    prompts: {system: '系统提示词', persist: {}, dynamic: {}},
    tools: {allow: ['read']},
};

const mockRuntime = {
    agentRegistry: {
        getRawWire: mockGetRawWire,
        listAgentIds: jest.fn().mockResolvedValue(['agent-a']),
        delete: jest.fn(),
        upsert: jest.fn().mockResolvedValue(undefined),
    },
    providers: {list: jest.fn().mockResolvedValue(Result.ok([]))},
    providerModels: {
        savedList: jest.fn().mockResolvedValue([]),
        getSavedById: jest.fn().mockResolvedValue(null),
    },
    state: {getCurrentModelId: jest.fn().mockResolvedValue(null)},
    mcp: {connectionManager: {snapshotTools: mockSnapshotTools}},
};

// ToolPolicyPicker 记录收到的 props（接线断言点：mcpTools 是否映射成注册名窄视图）。
const mockPickerProps: {mcpTools?: readonly unknown[]}[] = [];

jest.mock('@/components/agent/ToolPolicyPicker', () => ({
    ToolPolicyPicker: (props: {mcpTools?: readonly unknown[]}) => {
        mockPickerProps.push(props);
        return null;
    },
}));

jest.mock('@novel-master/core', () => ({
    BuiltinTools: {register: jest.fn()},
    ToolRegistry: class {
        list() {
            return ['read'];
        }
    },
}));

jest.mock('@/theme/ThemeProvider', () => ({
    useTheme: () => ({
        tokens: {
            text: '#111',
            textSecondary: '#666',
            textTertiary: '#999',
            surface: '#fff',
            bgSecondary: '#f5f5f5',
            border: '#ddd',
            borderLight: '#ddd',
            primary: '#007aff',
            danger: '#ff3b30',
        },
    }),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
    useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({
        goBack: jest.fn(),
        push: jest.fn(),
        addListener: jest.fn(() => () => undefined),
        removeListener: jest.fn(),
    }),
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@/components/form/FormOverlayHost', () => ({
    useFormOverlay: () => ({show: jest.fn(), hide: jest.fn()}),
}));

jest.mock('@/components/form/FormField', () => {
    const mockReact = require('react');
    return {
        FormField: ({children}: {children?: React.ReactNode}) =>
            mockReact.createElement('View', null, children),
    };
});

jest.mock('@/components/form/FormSectionCard', () => {
    const mockReact = require('react');
    return {
        FormSectionCard: ({children}: {children?: React.ReactNode}) =>
            mockReact.createElement('View', null, children),
    };
});

jest.mock('@/components/form/FormSelectField', () => ({
    FormSelectField: () => null,
}));

jest.mock('@/components/form/FormSwitchRow', () => ({
    FormSwitchRow: () => null,
}));

jest.mock('@/components/form/ScreenFormLayout', () => {
    const mockReact = require('react');
    return {
        ScreenFormLayout: ({
            children,
            footer,
        }: {
            children?: React.ReactNode;
            footer?: React.ReactNode;
        }) => mockReact.createElement('View', null, children, footer),
    };
});

jest.mock('@/components/form/StickyFormFooter', () => ({
    StickyFormFooter: () => null,
}));

jest.mock('@/components/vfs/CodeEditorWebView', () => {
    const mockReact = require('react');
    return {
        CodeEditorWebView: () => null,
    };
});

jest.mock('@/components/ui/SegmentedControl', () => ({
    SegmentedControl: () => null,
}));

jest.mock('@/components/vfs/FileMarkdownPreview', () => ({
    FileMarkdownPreview: () => null,
}));

jest.mock('@/navigation/HeaderContext', () => ({
    useHeaderContext: () => ({setStackOverride: jest.fn()}),
    useStackOverrideSetter: () => jest.fn(),
}));

jest.mock('@/errors/toast-message', () => {
    const legacy = {
        toastMessage: (_title: string, err: unknown) => String(err),
    };
    return {...legacy, ToastMessage: {toast: legacy.toastMessage}};
});

jest.mock('@/services/agent-yaml.service', () => ({
    AgentYamlService: {exportYaml: jest.fn(), importYaml: jest.fn()},
}));

// runtime 直接 mock 在 hook 层（照 agent-editor-form 系列先例）：mcp 切片是接线
// 断言的数据源；真实 context 会拉起整个 runtime 模块图（create-mobile-runtime →
// mcp-config.store，后者消费宽的 core/mcp barrel，jest 映射只放行 McpToolSlug）。
jest.mock('@/hooks/useRuntime', () => ({
    useRuntime: () => mockRuntime,
}));

jest.mock('@/runtime/novel-master-context', () => ({
    useNovelMaster: () => ({status: 'loading', runtime: null}),
}));

import {AgentEditorForm} from '@/components/agent/AgentEditorForm';

async function renderEditor(wire: unknown) {
    mockGetRawWire.mockResolvedValue(wire);
    await act(async () => {
        TestRenderer.create(<AgentEditorForm agentId="agent-a" />);
    });
    // flush 装载链（getRawWire → providers → savedModels）与 mcp 快照 effect 的
    // 全部微任务；dirty 测试 3 轮够是它只断言保存链路，这里 picker 收 prop 在
    // 装载完成之后，多留几轮。
    await act(async () => {
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
        }
    });
}

describe('AgentEditorForm 的 MCP 快照接线（spec §九移动端）', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPickerProps.length = 0;
    });

    it('页面打开时刻把快照映射成注册名窄视图传给 ToolPolicyPicker', async () => {
        mockSnapshotTools.mockResolvedValue([{serverId: 'demo', serverName: '演示服务', toolName: 'echo', toolDescription: '回声工具'}]);
        await renderEditor(wireWithAllowPolicy);
        const pickerProps = mockPickerProps[mockPickerProps.length - 1];
        expect(pickerProps).toBeDefined();
        expect(pickerProps?.mcpTools).toEqual([{registeredName: 'mcp__demo__echo', serverName: '演示服务', toolDescription: '回声工具'}]);
    });

    it('快照读取失败静默回落空数组（picker 侧组装「未配置」占位）', async () => {
        mockSnapshotTools.mockRejectedValue(new Error('network down'));
        await renderEditor(wireWithAllowPolicy);
        const pickerProps = mockPickerProps[mockPickerProps.length - 1];
        expect(pickerProps).toBeDefined();
        expect(pickerProps?.mcpTools).toEqual([]);
    });
});
