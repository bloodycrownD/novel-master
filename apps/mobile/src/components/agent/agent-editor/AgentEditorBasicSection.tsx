/**
 * 「基本信息」区（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * YAML 导入/导出、名称、作用域、描述。
 */
import React from 'react';
import {Pressable, Text, View} from 'react-native';

import {MODE_OPTIONS, type AgentMode} from '@/config-forms/agent';

import {coreT} from '@/i18n/core';

import {FormField} from '../../form/FormField';
import {FormSectionCard} from '../../form/FormSectionCard';
import {FormSelectField} from '../../form/FormSelectField';
import {FormTextInput} from '../../form/FormTextInput';
import {styles} from './agent-editor-form.styles';
import {type AgentEditorTokens} from './agent-editor-types';

type Props = {
  tokens: AgentEditorTokens;
  name: string;
  onNameChange: (value: string) => void;
  mode: AgentMode;
  onModeChange: (value: AgentMode) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  onImportYaml: () => void;
  onExportYaml: () => void;
  /** 只读态（内置智能体详情）：YAML 导入/导出与各输入控件全禁用灰显。 */
  readOnly?: boolean;
};

export function AgentEditorBasicSection({
  tokens,
  name,
  onNameChange,
  mode,
  onModeChange,
  description,
  onDescriptionChange,
  onImportYaml,
  onExportYaml,
  readOnly = false,
}: Props) {
  return (
    <FormSectionCard title={coreT({key: "ui.agent.basic_info"})} tokens={tokens}>
      <View style={styles.yamlActions}>
        <Pressable
          disabled={readOnly}
          style={readOnly ? styles.yamlActionDisabled : undefined}
          onPress={() => onImportYaml()}
        >
          <Text style={{color: tokens.primary, fontWeight: '600'}}>
            {coreT({key: "ui.agent.import_yaml"})}
          </Text>
        </Pressable>
        <Pressable
          disabled={readOnly}
          style={readOnly ? styles.yamlActionDisabled : undefined}
          onPress={() => onExportYaml()}
        >
          <Text style={{color: tokens.primary, fontWeight: '600'}}>
            {coreT({key: "ui.agent.export_yaml"})}
          </Text>
        </Pressable>
      </View>
      <FormField label={coreT({key: "ui.common.name"})} tokens={tokens}>
        <FormTextInput
          tokens={tokens}
          value={name}
          onChangeText={onNameChange}
          disabled={readOnly}
        />
      </FormField>
      <FormField label={coreT({key: "ui.agent.scope"})} tokens={tokens}>
        <FormSelectField
          tokens={tokens}
          value={mode}
          onChange={value => onModeChange(value as AgentMode)}
          options={MODE_OPTIONS}
          sheetTitle={coreT({key: "ui.agent.scope_picker_title"})}
          disabled={readOnly}
        />
      </FormField>
      <FormField
        label={coreT({key: "ui.common.description"})}
        tokens={tokens}
        hint={coreT({key: "ui.agent.description_hint"})}
      >
        <FormTextInput
          tokens={tokens}
          value={description}
          onChangeText={onDescriptionChange}
          multiline
          disabled={readOnly}
          placeholder={coreT({key: "ui.agent.description_placeholder"})}
        />
      </FormField>
    </FormSectionCard>
  );
}
