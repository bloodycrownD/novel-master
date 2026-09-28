/**
 * 「工具策略」区（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * 模式下拉 + 白/黑名单选择；默认模式下的内置工具计数文案是
 * 硬编码源码锁（__tests__/agent-editor-form-tool-count.test.tsx 行为断言锁展示文案），
 * 改内置工具时需同步这里的计数。
 */
import React from 'react';
import {Text} from 'react-native';

import {
  TOOL_MODE_OPTIONS,
  type ToolsMode,
} from '@novel-master/core/config-forms/agent';

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
  /** 只读态（内置智能体详情）：模式下拉与工具选择器全禁用灰显。 */
  readOnly?: boolean;
};

export function AgentEditorToolsSection({
  tokens,
  toolsMode,
  onToolsModeChange,
  toolsSelected,
  onToolsSelectedChange,
  readOnly = false,
}: Props) {
  return (
    <FormSectionCard title="工具策略" tokens={tokens}>
      <FormField label="模式" tokens={tokens}>
        <FormSelectField
          tokens={tokens}
          value={toolsMode}
          onChange={value => onToolsModeChange(value as ToolsMode)}
          options={TOOL_MODE_OPTIONS}
          sheetTitle="工具名单模式"
          disabled={readOnly}
        />
      </FormField>
      {toolsMode !== 'default' ? (
        <FormField
          label={toolsMode === 'allow' ? '白名单工具' : '黑名单工具'}
          tokens={tokens}
        >
          <ToolPolicyPicker
            tokens={tokens}
            selected={toolsSelected}
            onChange={onToolsSelectedChange}
            disabled={readOnly}
          />
        </FormField>
      ) : (
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>
          未配置时使用全部内置工具（11
          个）：task、read、write、edit、fs、glob、grep、skill、agent、curl、search。
        </Text>
      )}
    </FormSectionCard>
  );
}
