/**
 * 「持久化区」卡（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * 区头开关 + 添加入口、text 块列表（名称/角色/内容）、空态与禁用态提示。
 */
import React from 'react';
import {Text, View} from 'react-native';

import type {
  PersistPromptBlock,
  PersistTextPromptBlock,
} from '@novel-master/core/prompt';
import {
  PROMPT_REGION_LABELS,
  ROLE_OPTIONS,
  mapPersistTextBlocks,
} from '@novel-master/core/config-forms/agent';

import {ExpandablePromptInput} from '../ExpandablePromptInput';
import {FormField} from '../../form/FormField';
import {FormSelectField} from '../../form/FormSelectField';
import {FormTextInput} from '../../form/FormTextInput';
import {PromptBlockActions} from './PromptBlockActions';
import {PromptSectionHead} from './PromptSectionHead';
import {styles} from './agent-editor-form.styles';
import {type AgentEditorTokens} from './agent-editor-types';

type Props = {
  tokens: AgentEditorTokens;
  label: string;
  persistEnabled: boolean;
  onPersistEnabledChange: (value: boolean) => void;
  persist: PersistPromptBlock[];
  setPersist: (
    apply: (prev: PersistPromptBlock[]) => PersistPromptBlock[],
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

export function PersistBlocksCard({
  tokens,
  label,
  persistEnabled,
  onPersistEnabledChange,
  persist,
  setPersist,
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
        switchValue={persistEnabled}
        onSwitchChange={onPersistEnabledChange}
        {...(persistEnabled ? {onAdd} : {})}
      />
      <View style={blockCardStyle}>
        {persistEnabled ? (
          <View style={styles.blockList}>
            {persist.filter(
              (b): b is PersistTextPromptBlock => b.type === 'text',
            ).length === 0 ? (
              <Text
                style={[
                  styles.emptyHint,
                  {
                    color: tokens.textSecondary,
                    borderColor: tokens.borderLight,
                  },
                ]}
              >
                {PROMPT_REGION_LABELS.emptyPersistHint}
              </Text>
            ) : null}
            {persist
              .filter((b): b is PersistTextPromptBlock => b.type === 'text')
              .map((block, index, textBlocks) => (
                <View key={`persist-block-${index}`} style={blockCardStyle}>
                  <View style={styles.blockHeader}>
                    <Text
                      style={[styles.blockName, {color: tokens.text}]}
                      numberOfLines={1}
                    >
                      {block.name}
                    </Text>
                    <PromptBlockActions
                      index={index}
                      total={textBlocks.length}
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
                        setPersist(prev =>
                          mapPersistTextBlocks(prev, (b, i) =>
                            i === index ? {...b, name: v} : b,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <FormField label="角色" tokens={tokens}>
                    <FormSelectField
                      tokens={tokens}
                      value={block.role}
                      onChange={role =>
                        setPersist(prev =>
                          mapPersistTextBlocks(prev, (b, i) =>
                            i === index
                              ? {
                                  ...b,
                                  role: role as PersistTextPromptBlock['role'],
                                }
                              : b,
                          ),
                        )
                      }
                      options={ROLE_OPTIONS}
                      sheetTitle="选择角色"
                    />
                  </FormField>
                  <Text
                    style={[styles.fieldHint, {color: tokens.textSecondary}]}
                  >
                    {PROMPT_REGION_LABELS.persistRegionHint}
                  </Text>
                  {(() => {
                    // persist 是 filter 后 text 块的 index，闭包捕获当次渲染的 index 回填。
                    const updatePersistContent = (v: string) =>
                      setPersist(prev =>
                        mapPersistTextBlocks(prev, (b, i) =>
                          i === index ? {...b, content: v} : b,
                        ),
                      );
                    return (
                      <ExpandablePromptInput
                        label="内容"
                        openEditor={() =>
                          openPromptEditor(block.name, block.content, v =>
                            setPersist(prev =>
                              mapPersistTextBlocks(prev, (b, i) =>
                                i === index ? {...b, content: v} : b,
                              ),
                            ),
                          )
                        }
                        renderInline={ctx => (
                          <FormTextInput
                            tokens={tokens}
                            value={block.content}
                            onChangeText={updatePersistContent}
                            multiline
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
            {PROMPT_REGION_LABELS.persistDisabledHint}
          </Text>
        )}
      </View>
    </>
  );
}
