/**
 * 「模型」区（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * 扁平化的「专属模型」单下拉，空串代表默认(跟随)。
 */
import React from 'react';

import {coreT} from '@/i18n/core';

import {FormField} from '../../form/FormField';
import {FormSectionCard} from '../../form/FormSectionCard';
import {FormSelectField} from '../../form/FormSelectField';
import {type AgentEditorTokens} from './agent-editor-types';

type Props = {
    tokens: AgentEditorTokens;
    value: string;
    onChange: (id: string) => void;
    options: Array<{value: string; label: string; subtitle?: string}>;
    /** 只读态（内置智能体详情）：下拉禁点并灰显。 */
    readOnly?: boolean;
};

export function AgentEditorModelSection({
    tokens,
    value,
    onChange,
    options,
    readOnly = false,
}: Props) {
    return (
        <FormSectionCard title={coreT({key: "ui.common.model"})} tokens={tokens}>
            <FormField
                label={coreT({key: "ui.agent.model_dedicated"})}
                tokens={tokens}
                hint={coreT({key: "ui.agent.model_follow_hint"})}
            >
                <FormSelectField
                    tokens={tokens}
                    value={value}
                    onChange={onChange}
                    options={options}
                    sheetTitle={coreT({key: "ui.agent.model_picker_title"})}
                    placeholder={coreT({key: "ui.agent.model_follow_option"})}
                    emptyLabel={coreT({key: "ui.agent.no_models_hint"})}
                    disabled={readOnly}
                />
            </FormField>
        </FormSectionCard>
    );
}
