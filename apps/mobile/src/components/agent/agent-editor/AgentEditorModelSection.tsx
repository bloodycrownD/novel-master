/**
 * 「模型」区（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * 扁平化的「专属模型」单下拉，空串代表默认(跟随)。
 */
import React from 'react';

import {FormField} from '../../form/FormField';
import {FormSectionCard} from '../../form/FormSectionCard';
import {FormSelectField} from '../../form/FormSelectField';
import {type AgentEditorTokens} from './agent-editor-types';

type Props = {
  tokens: AgentEditorTokens;
  value: string;
  onChange: (id: string) => void;
  options: Array<{value: string; label: string; subtitle?: string}>;
};

export function AgentEditorModelSection({
  tokens,
  value,
  onChange,
  options,
}: Props) {
  return (
    <FormSectionCard title="模型" tokens={tokens}>
      <FormField
        label="专属模型"
        tokens={tokens}
        hint="默认(跟随) 表示使用会话操作抽屉 / 我的里设置的当前模型。">
        <FormSelectField
          tokens={tokens}
          value={value}
          onChange={onChange}
          options={options}
          sheetTitle="选择专属模型"
          placeholder="默认(跟随)"
          emptyLabel="请先在「服务商」页添加模型"
        />
      </FormField>
    </FormSectionCard>
  );
}
