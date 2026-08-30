/**
 * 「基本信息」区（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * YAML 导入/导出、名称、作用域、描述。
 */
import React from 'react';
import {Pressable, Text, View} from 'react-native';

import {MODE_OPTIONS, type AgentMode} from '@novel-master/core/config-forms/agent';

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
}: Props) {
  return (
    <FormSectionCard title="基本信息" tokens={tokens}>
      <View style={styles.yamlActions}>
        <Pressable onPress={() => onImportYaml()}>
          <Text style={{color: tokens.primary, fontWeight: '600'}}>
            导入 YAML
          </Text>
        </Pressable>
        <Pressable onPress={() => onExportYaml()}>
          <Text style={{color: tokens.primary, fontWeight: '600'}}>
            导出 YAML
          </Text>
        </Pressable>
      </View>
      <FormField label="名称" tokens={tokens}>
        <FormTextInput tokens={tokens} value={name} onChangeText={onNameChange} />
      </FormField>
      <FormField label="作用域" tokens={tokens}>
        <FormSelectField
          tokens={tokens}
          value={mode}
          onChange={value => onModeChange(value as AgentMode)}
          options={MODE_OPTIONS}
          sheetTitle="选择作用域"
        />
      </FormField>
      <FormField
        label="描述"
        tokens={tokens}
        hint="向 task 工具说明这个智能体擅长什么，可留空。">
        <FormTextInput
          tokens={tokens}
          value={description}
          onChangeText={onDescriptionChange}
          multiline
          placeholder="例如：擅长检索代码库、写测试。"
        />
      </FormField>
    </FormSectionCard>
  );
}
