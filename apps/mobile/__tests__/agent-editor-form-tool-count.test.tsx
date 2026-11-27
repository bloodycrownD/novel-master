/**
 * T-AG5：AgentEditorForm 内置工具计数文案（行为断言）。
 *
 * 计数取 BUILTIN_TOOL_CATALOG.length（自动为 12），但 i18n 文案里的
 * 工具枚举串是硬编码，锁住「12 个」与名单含 mcp、curl，防止后续加内置
 * 工具时漏改。
 * tests/G-3：改 TestRenderer 渲染 default 模式断实际展示文案，
 * 等价重构（挪文案、改结构）不再碎。
 */
import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {AgentEditorToolsSection} from '@/components/agent/agent-editor/AgentEditorToolsSection';
import {FormOverlayProvider} from '@/components/form/FormOverlayHost';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

// ModalShell → useTheme 会拉起 novel-master-context（整套 runtime），
// 测试只关文案展示，把主题链剪断。
jest.mock('@/theme/ThemeProvider', () => ({
    useTheme: () => ({
        tokens: {
            background: '#fff',
            bgSecondary: '#eee',
            surface: '#f8f8f8',
            surfaceElevated: '#f0f0f0',
            text: '#111',
            textSecondary: '#666',
            textTertiary: '#999',
            border: '#ccc',
            borderLight: '#e0e0e0',
            primary: '#007aff',
            danger: '#f00',
        },
    }),
}));

const tokens = {
    background: '#fff',
    bgSecondary: '#eee',
    surface: '#f8f8f8',
    surfaceElevated: '#f0f0f0',
    text: '#111',
    textSecondary: '#666',
    textTertiary: '#999',
    border: '#ccc',
    borderLight: '#e0e0e0',
    primary: '#007aff',
    danger: '#f00',
} as never;

function renderDefaultMode(): string {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
        renderer = TestRenderer.create(
            <FormOverlayProvider>
                <AgentEditorToolsSection
                    tokens={tokens}
                    toolsMode="default"
                    onToolsModeChange={jest.fn()}
                    toolsSelected={[]}
                    onToolsSelectedChange={jest.fn()}
                />
            </FormOverlayProvider>,
        );
    });
    return JSON.stringify(renderer.toJSON());
}

describe('AgentEditorForm builtin tools hint (T-AG5)', () => {
    it('默认模式展示提示文案计 12 个且名单含 mcp 与 curl（T-MO4）', () => {
        const json = renderDefaultMode();
        expect(json).toContain('未配置时使用全部内置工具（12 个）');
        expect(json).toContain(
            'task、read、write、edit、fs、glob、grep、skill、agent、curl、search、mcp。',
        );
    });

    it('不再残留 8 / 10 / 11 个的旧计数', () => {
        expect(renderDefaultMode()).not.toContain('全部内置工具（8');
        expect(renderDefaultMode()).not.toContain('全部内置工具（10');
        expect(renderDefaultMode()).not.toContain('全部内置工具（11');
    });
});
