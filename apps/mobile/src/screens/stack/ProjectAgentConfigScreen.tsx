/**
 * 项目智能体配置：压缩配置式开关（关=跟随全局，开=项目专属）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, StyleSheet, Text, View} from 'react-native';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {type AgentDefinition} from '@novel-master/core/agent';
import {registerBuiltinTools, ToolRegistry} from '@novel-master/core';
import {type ProjectAgentConfig, type ProjectAgentMode} from '@novel-master/core/chat';
import {buildDefaultAgentDefinitionPreservingName} from '@novel-master/core/config-forms/stored-config-validity';
import {AgentEditorForm} from '../../components/agent/AgentEditorForm';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormSwitchRow} from '../../components/form/FormSwitchRow';
import {useUnsavedGuard} from '../../hooks/useUnsavedGuard';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {resolveCurrentAgentDefinition} from '../../services/agent-run.service';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type ScreenRoute = RouteProp<RootStackParamList, 'ProjectAgentConfig'>;

function cloneDefinition(def: AgentDefinition): AgentDefinition {
  return JSON.parse(JSON.stringify(def)) as AgentDefinition;
}

async function resolveInitialCustomDefinition(
  runtime: ReturnType<typeof useRuntime>,
): Promise<AgentDefinition> {
  try {
    const {definition} = await resolveCurrentAgentDefinition(runtime);
    return cloneDefinition(definition);
  } catch {
    return buildDefaultAgentDefinitionPreservingName('项目专属');
  }
}

function buildAgentConfigUpdateOptions() {
  const probe = new ToolRegistry();
  registerBuiltinTools(probe);
  return {registeredToolNames: probe.list()} as const;
}

export function ProjectAgentConfigScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const route = useRoute<ScreenRoute>();
  const projectId = route.params?.projectId;
  const [mode, setMode] = useState<ProjectAgentMode>('follow');
  const [config, setConfig] = useState<ProjectAgentConfig | null>(null);
  const [globalAgentName, setGlobalAgentName] = useState('');
  const [loading, setLoading] = useState(true);
  const [modeBusy, setModeBusy] = useState(false);
  const [formDirty, setFormDirty] = useState(false);

  useUnsavedGuard(formDirty);

  const load = useCallback(async () => {
    if (projectId == null) {
      return;
    }
    setLoading(true);
    try {
      const cfg = await runtime.projects.getAgentConfig(projectId);
      let globalName = '（无全局 Agent）';
      try {
        const resolved = await resolveCurrentAgentDefinition(runtime);
        globalName = resolved.definition.name;
      } catch {
        /* 跟随模式下仍展示占位文案 */
      }
      setConfig(cfg);
      setMode(cfg.mode);
      setGlobalAgentName(globalName);
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      setLoading(false);
    }
  }, [projectId, runtime, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const handleModeChange = useCallback(
    async (next: ProjectAgentMode) => {
      if (projectId == null || next === mode || modeBusy) {
        return;
      }
      if (formDirty) {
        Alert.alert('未保存', '请先保存或放弃自定义配置中的更改。');
        return;
      }
      setModeBusy(true);
      try {
        const opts = buildAgentConfigUpdateOptions();
        if (next === 'custom') {
          const current =
            config ?? (await runtime.projects.getAgentConfig(projectId));
          if (current.definition == null) {
            const definition = await resolveInitialCustomDefinition(runtime);
            const updated = await runtime.projects.updateAgentConfig(
              projectId,
              {mode: 'custom', definition},
              opts,
            );
            setConfig(updated);
          } else {
            const updated = await runtime.projects.updateAgentConfig(
              projectId,
              {mode: 'custom'},
              opts,
            );
            setConfig(updated);
          }
        } else {
          const updated = await runtime.projects.updateAgentConfig(
            projectId,
            {mode: 'follow'},
            opts,
          );
          setConfig(updated);
        }
        setMode(next);
      } catch (error) {
        showToast(toastMessage('切换模式失败', error));
      } finally {
        setModeBusy(false);
      }
    },
    [config, formDirty, mode, modeBusy, projectId, runtime, showToast],
  );

  if (projectId == null) {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <Text style={{color: tokens.textSecondary, padding: 16}}>
          缺少 projectId
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, {backgroundColor: tokens.background}]}>
        <Text style={{color: tokens.textSecondary}}>加载中…</Text>
      </View>
    );
  }

  const customEnabled = mode === 'custom';

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <View style={styles.content}>
        <FormSectionCard
          title="项目智能体配置"
          tokens={tokens}
          hint="关闭时跟随全局智能体；开启后为本项目单独配置，会话中将显示「项目智能体」。">
          <FormSwitchRow
            label="启用项目专属智能体"
            tokens={tokens}
            value={customEnabled}
            disabled={modeBusy}
            testID="project-agent-custom-switch"
            onValueChange={enabled => {
              void handleModeChange(enabled ? 'custom' : 'follow').catch(
                () => undefined,
              );
            }}
          />
          {!customEnabled ? (
            <View style={styles.followBody}>
              <Text style={[styles.followTitle, {color: tokens.text}]}>
                跟随全局智能体
              </Text>
              <Text style={[styles.followMeta, {color: tokens.textSecondary}]}>
                当前全局：{globalAgentName}
              </Text>
              <Text style={[styles.followHint, {color: tokens.textTertiary}]}>
                本项目对话将使用全局当前 Agent 的配置；关闭专属配置时会保留自定义草稿但不生效。
              </Text>
            </View>
          ) : null}
        </FormSectionCard>

        {customEnabled ? (
          config?.definition != null ? (
            <AgentEditorForm
              editorMode="project"
              projectId={projectId}
              initialDefinition={config.definition}
              onDirtyChange={setFormDirty}
              onSaved={async () => {
                setFormDirty(false);
                const refreshed = await runtime.projects.getAgentConfig(projectId);
                setConfig(refreshed);
              }}
            />
          ) : (
            <View style={styles.center}>
              <Text style={{color: tokens.textSecondary}}>
                正在准备自定义配置…
              </Text>
            </View>
          )
        ) : null}
      </View>
      {modeBusy ? (
        <View style={styles.busyOverlay} pointerEvents="none">
          <Text style={{color: tokens.textSecondary}}>切换模式中…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {flex: 1, paddingTop: 8, paddingHorizontal: 5},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  followBody: {marginTop: 12, gap: 6},
  followTitle: {fontSize: 16, fontWeight: '600'},
  followMeta: {fontSize: 14, lineHeight: 20},
  followHint: {fontSize: 13, lineHeight: 19},
  busyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
});
