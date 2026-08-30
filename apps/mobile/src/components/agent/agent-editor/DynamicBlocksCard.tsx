/**
 * 「动态区」卡（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * 区头开关 + 添加入口、块列表（名称/角色/常驻开关/宏内容）、空态与禁用态提示。
 */
import React from 'react';
import {Text, View} from 'react-native';

import type {DynamicPromptBlock} from '@novel-master/core/prompt';
import {
  PROMPT_REGION_LABELS,
  ROLE_OPTIONS,
  isDynamicBlockPersistent,
  withDynamicBlockPersistence,
} from '@novel-master/core/config-forms/agent';

import {ExpandablePromptInput} from '../ExpandablePromptInput';
import {FormField} from '../../form/FormField';
import {FormSelectField} from '../../form/FormSelectField';
import {FormSwitchRow} from '../../form/FormSwitchRow';
import {FormTextInput} from '../../form/FormTextInput';
import {PromptMacroTextInput} from '../PromptMacroTextInput';
import {PromptBlockActions} from './PromptBlockActions';
import {PromptSectionHead} from './PromptSectionHead';
import {styles} from './agent-editor-form.styles';
import {type AgentEditorTokens} from './agent-editor-types';

type Props = {
  tokens: AgentEditorTokens;
  label: string;
  dynamicEnabled: boolean;
  onDynamicEnabledChange: (value: boolean) => void;
  dynamic: DynamicPromptBlock[];
  setDynamic: (
    apply: (prev: DynamicPromptBlock[]) => DynamicPromptBlock[],
  ) => void;
  onAdd: () => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onDelete: (index: number) => void;
  openPromptEditor: (
    title: string,
    text: string,
    onSaved: (text: string) => void,
  ) => void;
};

export function DynamicBlocksCard({
  tokens,
  label,
  dynamicEnabled,
  onDynamicEnabledChange,
  dynamic,
  setDynamic,
  onAdd,
  onMove,
  onDelete,
  openPromptEditor,
}: Props) {
  /** 内层区块卡片统一样式：白底常规边框 + 左侧主题色粗边。 */
  const blockCardStyle = [
    styles.blockCard,
    {
      backgroundColor: tokens.surface,
      borderColor: tokens.border,
      borderLeftColor: tokens.primary,
    },
  ];

  return (
    <>
      <PromptSectionHead
        label={label}
        tokens={tokens}
        switchValue={dynamicEnabled}
        onSwitchChange={onDynamicEnabledChange}
        {...(dynamicEnabled ? {onAdd} : {})}
      />
      <View style={blockCardStyle}>
        {dynamicEnabled ? (
          <View style={styles.blockList}>
            {dynamic.length === 0 ? (
              <Text
                style={[
                  styles.emptyHint,
                  {
                    color: tokens.textSecondary,
                    borderColor: tokens.borderLight,
                  },
                ]}
              >
                {PROMPT_REGION_LABELS.emptyDynamicHint}
              </Text>
            ) : null}
            {dynamic.map((block, index) => (
              <View key={`dynamic-block-${index}`} style={blockCardStyle}>
                <View style={styles.blockHeader}>
                  <Text
                    style={[styles.blockName, {color: tokens.text}]}
                    numberOfLines={1}
                  >
                    {block.name}
                  </Text>
                  <PromptBlockActions
                    index={index}
                    total={dynamic.length}
                    tokens={tokens}
                    onMove={onMove}
                    onDelete={onDelete}
                  />
                </View>
                <FormField label="名称" tokens={tokens}>
                  <FormTextInput
                    tokens={tokens}
                    value={block.name}
                    onChangeText={v =>
                      setDynamic(prev =>
                        prev.map((b, i) => (i === index ? {...b, name: v} : b)),
                      )
                    }
                  />
                </FormField>
                <FormField label="角色" tokens={tokens}>
                  <FormSelectField
                    tokens={tokens}
                    value={block.role}
                    onChange={role =>
                      setDynamic(prev =>
                        prev.map((b, i) =>
                          i === index
                            ? {...b, role: role as DynamicPromptBlock['role']}
                            : b,
                        ),
                      )
                    }
                    options={ROLE_OPTIONS}
                    sheetTitle="选择角色"
                  />
                </FormField>
                <FormSwitchRow
                  label="常驻"
                  tokens={tokens}
                  value={isDynamicBlockPersistent(block)}
                  onValueChange={persistent =>
                    setDynamic(prev =>
                      prev.map((b, i) =>
                        i === index
                          ? withDynamicBlockPersistence(b, persistent)
                          : b,
                      ),
                    )
                  }
                />
                {!isDynamicBlockPersistent(block) ? (
                  <Text
                    style={[styles.fieldHint, {color: tokens.textSecondary}]}
                  >
                    {PROMPT_REGION_LABELS.dynamicLifecycleOnceHint}
                  </Text>
                ) : null}
                {(() => {
                  const updateDynamicContent = (v: string) =>
                    setDynamic(prev =>
                      prev.map((b, i) =>
                        i === index ? {...b, content: v} : b,
                      ),
                    );
                  return (
                    <ExpandablePromptInput
                      label="内容"
                      openEditor={() =>
                        openPromptEditor(block.name, block.content, v =>
                          setDynamic(prev =>
                            prev.map((b, i) =>
                              i === index ? {...b, content: v} : b,
                            ),
                          ),
                        )
                      }
                      renderInline={ctx => (
                        <PromptMacroTextInput
                          tokens={tokens}
                          value={block.content}
                          onChangeText={updateDynamicContent}
                          placeholder="支持 $time、$week_cn、$filetree…"
                          style={ctx.style}
                          selection={ctx.selection}
                          onSelectionChange={ctx.onSelectionChange}
                        />
                      )}
                    />
                  );
                })()}
              </View>
            ))}
          </View>
        ) : (
          <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
            {PROMPT_REGION_LABELS.dynamicDisabledHint}
          </Text>
        )}
      </View>
    </>
  );
}
