/**
 * 「工具策略」区（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * 模式下拉 + 白/黑名单选择；默认模式下的内置工具计数文案是
 * 硬编码源码锁（__tests__/agent-editor-form-tool-count.test.tsx 行为断言锁展示文案），
 * 改内置工具时需同步这里的计数。
 */
import React from 'react';
import {Text} from 'react-native';

import {BUILTIN_TOOL_CATALOG, TOOL_MODE_OPTIONS, type AgentToolCatalogMcpTool, type ToolsMode} from '@/config-forms/agent';

import {coreT} from '@/i18n/core';

import {FormField} from '../../form/FormField';
import {FormSectionCard} from '../../form/FormSectionCard';
import {FormSelectField} from '../../form/FormSelectField';
import {ToolPolicyPicker} from '../ToolPolicyPicker';
import {styles} from './agent-editor-form.styles';
import {type AgentEditorTokens} from './agent-editor-types';

type Props = {
    tokens: AgentEditorTokens;
    toolsMode: ToolsMode;
    onToolsModeChange: (value: ToolsMode) => void;
    toolsSelected: readonly string[];
    onToolsSelectedChange: (value: string[]) => void;
    /** 页面打开时刻的 MCP 工具快照（spec §九移动端直读 connection manager 缓存）；缺省 = mcp 分组只显示「未配置」占位。 */
    mcpTools?: readonly AgentToolCatalogMcpTool[];
    /** 只读态（内置智能体详情）：模式下拉与工具选择器全禁用灰显。 */
    readOnly?: boolean;
};

export function AgentEditorToolsSection({
    tokens,
    toolsMode,
    onToolsModeChange,
    toolsSelected,
    onToolsSelectedChange,
    mcpTools,
    readOnly = false,
}: Props) {
    return (
        <FormSectionCard title={coreT({key: "ui.agent.tools_section"})} tokens={tokens}>
            <FormField label={coreT({key: "ui.agent.tools_mode_label"})} tokens={tokens}>
                <FormSelectField
                    tokens={tokens}
                    value={toolsMode}
                    onChange={value => onToolsModeChange(value as ToolsMode)}
                    options={TOOL_MODE_OPTIONS}
                    sheetTitle={coreT({key: "ui.agent.tools_mode_picker_title"})}
                    disabled={readOnly}
                />
            </FormField>
            {toolsMode !== 'default' ? (
                <FormField
                    label={toolsMode === 'allow' ? coreT({key: "ui.agent.allowlist_label"}) : coreT({key: "ui.agent.denylist_label"})}
                    tokens={tokens}
                >
                    <ToolPolicyPicker
                        tokens={tokens}
                        selected={toolsSelected}
                        onChange={onToolsSelectedChange}
                        mcpTools={mcpTools}
                        disabled={readOnly}
                    />
                </FormField>
            ) : (
                <Text style={[styles.hint, {color: tokens.textSecondary}]}>
                    {coreT({key: "ui.agent.builtin_tools_hint", params: {count: String(BUILTIN_TOOL_CATALOG.length)}})}
                </Text>
            )}
        </FormSectionCard>
    );
}
