/**
 * 「提示词布局」卡（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * 系统区 / 技能索引区 / 常驻工作区 / 持久化区 / 会话区 / 动态区。
 * 持久化与动态两区委托给 PersistBlocksCard / DynamicBlocksCard。
 */
import React from 'react';
import {Text, View} from 'react-native';

import {
  DEFAULT_SKILLS_INDEX_PREFIX,
  PROMPT_REGION_LABELS,
  WORKPLACE_ASSISTANT_TEXT_LABEL,
  WORKPLACE_BLOCK_HINT,
  WORKPLACE_BLOCK_LABEL,
  WORKPLACE_DISABLED_HINT,
  withWorkplaceToggle,
} from '@novel-master/core/config-forms/agent';

import {ExpandablePromptInput} from '../ExpandablePromptInput';
import {FormSectionCard} from '../../form/FormSectionCard';
import {FormTextInput} from '../../form/FormTextInput';
import {PromptMacroTextInput} from '../PromptMacroTextInput';
import {PersistBlocksCard} from './PersistBlocksCard';
import {DynamicBlocksCard} from './DynamicBlocksCard';
import {PromptSectionHead} from './PromptSectionHead';
import {styles} from './agent-editor-form.styles';
import {type AgentEditorTokens} from './agent-editor-types';
import {type AgentEditorFormState, type AgentEditorFormPatch} from './useAgentEditorFormState';

// 自定义附加信息输入框文案（core 未导出，UI 层自管）。
const CUSTOM_ATTACH_TEXT_LABEL = '附加信息内容';

type Props = {
  tokens: AgentEditorTokens;
  form: AgentEditorFormState;
  patch: (partial: AgentEditorFormPatch) => void;
  setPersist: (
    apply: (prev: AgentEditorFormState['persist']) => AgentEditorFormState['persist'],
  ) => void;
  setDynamic: (
    apply: (prev: AgentEditorFormState['dynamic']) => AgentEditorFormState['dynamic'],
  ) => void;
  onMovePersist: (index: number, dir: -1 | 1) => void;
  onDeletePersist: (index: number) => void;
  onAddPersistTextBlock: () => void;
  onMoveDynamic: (index: number, dir: -1 | 1) => void;
  onDeleteDynamic: (index: number) => void;
  onAddDynamicBlock: () => void;
  openPromptEditor: (
    title: string,
    text: string,
    onSaved: (text: string) => void,
  ) => void;
};

export function PromptLayoutSection({
  tokens,
  form,
  patch,
  setPersist,
  setDynamic,
  onMovePersist,
  onDeletePersist,
  onAddPersistTextBlock,
  onMoveDynamic,
  onDeleteDynamic,
  onAddDynamicBlock,
  openPromptEditor,
}: Props) {
  /** 四区小标题；旧 core 包缺键时用本地兜底，避免标题空白。 */
  const promptSectionLabels = {
    system: PROMPT_REGION_LABELS.systemBlocks ?? '系统区',
    skills: PROMPT_REGION_LABELS.skillsBlocks ?? '技能索引区',
    persist: PROMPT_REGION_LABELS.persistBlocks,
    chat: PROMPT_REGION_LABELS.chatBlocks ?? '会话区',
    dynamic: PROMPT_REGION_LABELS.dynamicBlocks,
  };

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
    <FormSectionCard title={PROMPT_REGION_LABELS.layoutTitle} tokens={tokens}>
      <PromptSectionHead
        label={promptSectionLabels.system}
        tokens={tokens}
        switchValue={form.systemEnabled}
        onSwitchChange={value => patch({systemEnabled: value})}
      />
      <View style={blockCardStyle}>
        {form.systemEnabled ? (
          <ExpandablePromptInput
            label={PROMPT_REGION_LABELS.systemContent}
            openEditor={() =>
              openPromptEditor(
                PROMPT_REGION_LABELS.systemContent,
                form.systemContent,
                value => patch({systemContent: value}),
              )
            }
            renderInline={ctx => (
              <FormTextInput
                tokens={tokens}
                value={form.systemContent}
                onChangeText={value => patch({systemContent: value})}
                multiline
                style={ctx.style}
                selection={ctx.selection}
                onSelectionChange={ctx.onSelectionChange}
                placeholder={PROMPT_REGION_LABELS.systemPlaceholderShort}
              />
            )}
          />
        ) : (
          <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
            {PROMPT_REGION_LABELS.systemDisabledHint}
          </Text>
        )}
      </View>

      {/* 技能索引占位卡：运行时自动注入，不可配置 */}
      <PromptSectionHead
        label={promptSectionLabels.skills}
        tokens={tokens}
        switchValue={form.skillsEnabled}
        onSwitchChange={value => patch({skillsEnabled: value})}
      />
      <View style={blockCardStyle}>
        {form.skillsEnabled ? (
          <>
            <Text style={[styles.chatSlotHint, {color: tokens.textSecondary}]}>
              {PROMPT_REGION_LABELS.skillsReadonlyHint}
            </Text>
            <ExpandablePromptInput
              label="索引前缀语"
              openEditor={() =>
                openPromptEditor(
                  '索引前缀语',
                  form.skillsPrefixText,
                  value => patch({skillsPrefixText: value}),
                )
              }
              renderInline={ctx => (
                <FormTextInput
                  tokens={tokens}
                  value={form.skillsPrefixText}
                  onChangeText={value => patch({skillsPrefixText: value})}
                  multiline
                  style={ctx.style}
                  selection={ctx.selection}
                  onSelectionChange={ctx.onSelectionChange}
                  placeholder={DEFAULT_SKILLS_INDEX_PREFIX}
                />
              )}
            />
          </>
        ) : (
          <Text style={[styles.chatSlotHint, {color: tokens.textSecondary}]}>
            {PROMPT_REGION_LABELS.skillsDisabledHint}
          </Text>
        )}
      </View>

      <PromptSectionHead
        label={WORKPLACE_BLOCK_LABEL}
        tokens={tokens}
        switchValue={form.workplaceEnabled}
        onSwitchChange={next => {
          const patched = withWorkplaceToggle(
            next,
            form.workplaceAssistantText,
          );
          patch({
            workplaceEnabled: patched.workplaceEnabled,
            workplaceAssistantText: patched.workplaceAssistantText,
          });
        }}
      />
      <View style={blockCardStyle}>
        {form.workplaceEnabled ? (
          <>
            <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
              {WORKPLACE_BLOCK_HINT}
            </Text>
            <ExpandablePromptInput
              label={WORKPLACE_ASSISTANT_TEXT_LABEL}
              openEditor={() =>
                openPromptEditor(
                  WORKPLACE_ASSISTANT_TEXT_LABEL,
                  form.workplaceAssistantText,
                  value => patch({workplaceAssistantText: value}),
                )
              }
              renderInline={ctx => (
                <FormTextInput
                  tokens={tokens}
                  value={form.workplaceAssistantText}
                  onChangeText={value => patch({workplaceAssistantText: value})}
                  multiline
                  style={ctx.style}
                  selection={ctx.selection}
                  onSelectionChange={ctx.onSelectionChange}
                  placeholder={WORKPLACE_ASSISTANT_TEXT_LABEL}
                />
              )}
            />
          </>
        ) : (
          <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
            {WORKPLACE_DISABLED_HINT}
          </Text>
        )}
      </View>

      <PersistBlocksCard
        tokens={tokens}
        label={promptSectionLabels.persist}
        persistEnabled={form.persistEnabled}
        onPersistEnabledChange={value => patch({persistEnabled: value})}
        persist={form.persist}
        setPersist={setPersist}
        onAdd={onAddPersistTextBlock}
        onMove={onMovePersist}
        onDelete={onDeletePersist}
        openPromptEditor={openPromptEditor}
      />

      <PromptSectionHead
        label={promptSectionLabels.chat}
        tokens={tokens}
        switchValue={form.customAttachEnabled}
        onSwitchChange={value => patch({customAttachEnabled: value})}
      />
      <View style={blockCardStyle}>
        <Text style={[styles.chatSlotHint, {color: tokens.textSecondary}]}>
          用户聊天历史，开启后可给每次输入附加额外内容
        </Text>
        {form.customAttachEnabled ? (
          <ExpandablePromptInput
            label={CUSTOM_ATTACH_TEXT_LABEL}
            openEditor={() =>
              openPromptEditor(
                CUSTOM_ATTACH_TEXT_LABEL,
                form.customAttachText,
                value => patch({customAttachText: value}),
              )
            }
            renderInline={ctx => (
              <PromptMacroTextInput
                tokens={tokens}
                value={form.customAttachText}
                onChangeText={value => patch({customAttachText: value})}
                placeholder="支持 $time、$week_cn、$filetree…"
                style={ctx.style}
                selection={ctx.selection}
                onSelectionChange={ctx.onSelectionChange}
              />
            )}
          />
        ) : null}
      </View>

      <DynamicBlocksCard
        tokens={tokens}
        label={promptSectionLabels.dynamic}
        dynamicEnabled={form.dynamicEnabled}
        onDynamicEnabledChange={value => patch({dynamicEnabled: value})}
        dynamic={form.dynamic}
        setDynamic={setDynamic}
        onAdd={onAddDynamicBlock}
        onMove={onMoveDynamic}
        onDelete={onDeleteDynamic}
        openPromptEditor={openPromptEditor}
      />
    </FormSectionCard>
  );
}
