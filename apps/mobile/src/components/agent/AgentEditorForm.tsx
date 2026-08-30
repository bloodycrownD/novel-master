/**
 * Agent definition editor: name, model pin, maxSteps, three-region prompt layout.
 *
 * comp-rest/C-3 拆分：表单状态收拢在 useAgentEditorFormState（单 form state
 * 对象），各表单 section 子组件在 ./agent-editor/ 下，样式在
 * agent-editor-form.styles.ts。本文件只保留 Alert/导航/toast 编排与组装。
 */
import React, {useCallback, useEffect} from 'react';
import {Alert, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  buildAgentDefinitionFromForm,
  PROMPT_REGION_LABELS,
} from '@novel-master/core/config-forms/agent';
import {
  STORED_CONFIG_LABELS,
  buildDefaultAgentDefinitionPreservingName,
  storedConfigInvalidReason,
} from '@novel-master/core/config-forms/stored-config-validity';
import { registerBuiltinTools, ToolRegistry } from '@novel-master/core';

import {FormField} from '../form/FormField';
import {FormSectionCard} from '../form/FormSectionCard';
import {FormTextInput} from '../form/FormTextInput';
import {ScreenFormLayout} from '../form/ScreenFormLayout';
import {StickyFormFooter} from '../form/StickyFormFooter';
import {setPromptEditorOnSaved} from './prompt-editor-callback';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {
  exportAgentYaml,
  importAgentYaml,
} from '../../services/agent-yaml.service';
import type { RootStackParamList } from '../../navigation/types';

import {
  AgentEditorBasicSection,
} from './agent-editor/AgentEditorBasicSection';
import {AgentEditorInvalidCard} from './agent-editor/AgentEditorInvalidCard';
import {AgentEditorModelSection} from './agent-editor/AgentEditorModelSection';
import {AgentEditorToolsSection} from './agent-editor/AgentEditorToolsSection';
import {PromptLayoutSection} from './agent-editor/PromptLayoutSection';
import {styles} from './agent-editor/agent-editor-form.styles';
import {
  agentDisplayNameFromWire,
  useAgentEditorFormState,
} from './agent-editor/useAgentEditorFormState';

type StackNav = NativeStackNavigationProp<RootStackParamList>;

type Props = {
  agentId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void | Promise<void>;
};

export function AgentEditorForm(props: Props) {
  const { onDirtyChange, onSaved, agentId } = props;
  const { tokens } = useTheme();
  const { showToast } = useToast();
  const navigation = useNavigation<StackNav>();
  const runtime = useRuntime();

  const {
    form,
    patch,
    setPersist,
    setDynamic,
    movePersist,
    moveDynamic,
    deletePersist,
    deleteDynamic,
    addPersistTextBlock,
    addDynamicBlock,
    handleModelSelect,
    modelSelectOptions,
    snapshot,
    isDirty,
    setSavedBaseline,
    loadAgent,
    loading,
    loadError,
    invalidConfig,
    displayName,
    recovering,
    setRecovering,
    saving,
    setSaving,
  } = useAgentEditorFormState(agentId, runtime, showToast);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    loadAgent().catch(err => showToast(toastMessage('加载失败', err)));
  }, [loadAgent, showToast]);

  const handleDeleteBrokenAgent = useCallback(() => {
    Alert.alert('删除 Agent', `删除 Agent「${displayName ?? agentId}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const ids = await runtime.agentRegistry.listAgentIds();
              if (ids.length <= 1) {
                showToast('至少保留一个 Agent');
                return;
              }
              await runtime.agentRegistry.delete(agentId);
              navigation.goBack();
            } catch (error) {
              showToast(toastMessage('删除失败', error));
            }
          })();
        },
      },
    ]);
  }, [agentId, displayName, navigation, runtime, showToast]);

  const handleOverwriteDefault = useCallback(() => {
    Alert.alert(
      '覆盖为默认模板',
      '将用默认 prompts 与运行时覆盖当前配置，并保留 Agent ID 与显示名称。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '覆盖并保存',
          onPress: () => {
            void (async () => {
              setRecovering(true);
              try {
                const raw = await runtime.agentRegistry.getRawWire(agentId);
                const displayName = agentDisplayNameFromWire(raw, agentId);
                const def = buildDefaultAgentDefinitionPreservingName(
                  displayName.trim() || agentId,
                );
                const probe = new ToolRegistry();
                registerBuiltinTools(probe);
                await runtime.agentRegistry.upsert(agentId, def, {
                  registeredToolNames: probe.list(),
                });
                await loadAgent();
                await onSaved?.();
                showToast('已用默认模板覆盖并保存');
              } catch (error) {
                showToast(toastMessage('覆盖默认失败', error));
              } finally {
                setRecovering(false);
              }
            })();
          },
        },
      ],
    );
  }, [
    agentId,
    loadAgent,
    onSaved,
    runtime,
    setRecovering,
    showToast,
  ]);

  const handleSave = async () => {
    const built = buildAgentDefinitionFromForm(form);
    if (!built.ok) {
      showToast(built.message);
      return;
    }
    let def = built.definition;
    if (form.modelEnabled) {
      if (!form.savedModelId) {
        showToast('请选择专属模型');
        return;
      }
      def = { ...def, model: form.savedModelId };
    }
    setSaving(true);
    try {
      const probe = new ToolRegistry();
      registerBuiltinTools(probe);
      await runtime.agentRegistry.upsert(agentId, def, {
        registeredToolNames: probe.list(),
      });
      setSavedBaseline(snapshot);
      await onSaved?.();
      showToast('已保存智能体配置');
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
    }
  };

  const handleExportYaml = useCallback(async () => {
    try {
      const result = await exportAgentYaml(runtime, agentId);
      if (result === 'saved') {
        showToast('已导出 Agent YAML');
      }
    } catch (error) {
      showToast(toastMessage('导出 YAML 失败', error));
    }
  }, [runtime, agentId, showToast]);

  const handleImportYaml = useCallback(() => {
    Alert.alert('导入 YAML', '将覆盖当前智能体配置，是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '导入',
        onPress: () => {
          void (async () => {
            try {
              await importAgentYaml(runtime, agentId);
              await loadAgent();
              showToast('已导入 Agent YAML');
            } catch (error) {
              showToast(toastMessage('导入 YAML 失败', error));
            }
          })();
        },
      },
    ]);
  }, [runtime, agentId, loadAgent, showToast]);

  // 全屏编辑入口：回调先写进模块级存取再 push（路由参数必须可序列化，
  // 不再放函数），保存才用现有 setter 回填（自动触发 dirty，不另接线）。
  const openPromptEditor = useCallback(
    (title: string, text: string, onSaved: (text: string) => void) => {
      setPromptEditorOnSaved(onSaved);
      navigation.push('PromptEditor', {title, initialText: text});
    },
    [navigation],
  );

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={{ color: tokens.textSecondary }}>加载中…</Text>
      </View>
    );
  }

  if (loadError != null || invalidConfig != null) {
    const title =
      invalidConfig != null ? STORED_CONFIG_LABELS.invalidTitle : '加载失败';
    const reason =
      invalidConfig != null
        ? storedConfigInvalidReason(invalidConfig.code)
        : loadError ?? '';
    const detail = invalidConfig?.message ?? '';
    return (
      <AgentEditorInvalidCard
        tokens={tokens}
        title={title}
        reason={reason}
        detail={detail}
        recovering={recovering}
        onBack={() => navigation.goBack()}
        onOverwriteDefault={
          invalidConfig != null ? handleOverwriteDefault : undefined
        }
        onDelete={handleDeleteBrokenAgent}
      />
    );
  }

  return (
    <>
      {/* 未保存标记随 snapshot 同帧派生，避免跨组件 effect 通知在真机转场下刷新不及时 */}
      {isDirty ? (
        <View style={styles.unsavedWrap}>
          <FormSectionCard tokens={tokens}>
            <Text style={[styles.unsaved, {color: tokens.danger}]}>
              有未保存的更改
            </Text>
          </FormSectionCard>
        </View>
      ) : null}
      <ScreenFormLayout
        tokens={tokens}
        footer={
          <StickyFormFooter
            tokens={tokens}
            label="保存"
            loading={saving}
            onPress={() => handleSave().catch(() => undefined)}
          />
        }
      >
        <AgentEditorBasicSection
          tokens={tokens}
          name={form.name}
          onNameChange={value => patch({name: value})}
          mode={form.mode}
          onModeChange={value => patch({mode: value})}
          description={form.description}
          onDescriptionChange={value => patch({description: value})}
          onImportYaml={() => handleImportYaml()}
          onExportYaml={() => {
            handleExportYaml().catch(() => undefined);
          }}
        />

        <AgentEditorModelSection
          tokens={tokens}
          value={form.modelEnabled ? form.savedModelId : ''}
          onChange={handleModelSelect}
          options={modelSelectOptions}
        />

        <FormSectionCard title="运行时" tokens={tokens}>
          <FormField
            label={PROMPT_REGION_LABELS.maxStepsLabel}
            tokens={tokens}
            hint={PROMPT_REGION_LABELS.maxStepsHint}
          >
            <FormTextInput
              tokens={tokens}
              value={form.maxSteps}
              onChangeText={value => patch({maxSteps: value})}
              keyboardType="number-pad"
            />
          </FormField>
        </FormSectionCard>

        <AgentEditorToolsSection
          tokens={tokens}
          toolsMode={form.toolsMode}
          onToolsModeChange={value => patch({toolsMode: value})}
          toolsSelected={form.toolsSelected}
          onToolsSelectedChange={value => patch({toolsSelected: value})}
        />

        <PromptLayoutSection
          tokens={tokens}
          form={form}
          patch={patch}
          setPersist={setPersist}
          setDynamic={setDynamic}
          onMovePersist={movePersist}
          onDeletePersist={deletePersist}
          onAddPersistTextBlock={addPersistTextBlock}
          onMoveDynamic={moveDynamic}
          onDeleteDynamic={deleteDynamic}
          onAddDynamicBlock={addDynamicBlock}
          openPromptEditor={openPromptEditor}
        />
      </ScreenFormLayout>
    </>
  );
}
