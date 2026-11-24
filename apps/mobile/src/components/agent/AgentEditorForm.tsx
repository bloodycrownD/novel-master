/**
 * Agent definition editor: name, model pin, maxSteps, three-region prompt layout.
 *
 * comp-rest/C-3 拆分：表单状态收拢在 useAgentEditorFormState（单 form state
 * 对象），各表单 section 子组件在 ./agent-editor/ 下，样式在
 * agent-editor-form.styles.ts。本文件只保留 Alert/导航/toast 编排与组装。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

// nm-style: keep-local — 本文件的具名导入（core/config-forms 名称较长）单行化后均超 80 列，
// prettier 必拆回；按可读性保留拆行。
import {AgentEditorState, PROMPT_REGION_LABELS, type AgentToolCatalogMcpTool} from '@/config-forms/agent';
import {DefaultAgentDefinition, STORED_CONFIG_LABELS, StoredConfigLabels} from '@novel-master/core/stored-config-validity';
import {McpToolSlug} from '@novel-master/core/mcp';
import {BuiltinTools, ToolRegistry} from '@novel-master/core';

import {FormField} from '../form/FormField';
import {FormSectionCard} from '../form/FormSectionCard';
import {FormTextInput} from '../form/FormTextInput';
import {ScreenFormLayout} from '../form/ScreenFormLayout';
import {StickyFormFooter} from '../form/StickyFormFooter';
import {promptEditorOnSavedSlot} from './prompt-editor-callback';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {ToastMessage} from '../../errors/toast-message';
import {AgentYamlService} from '../../services/agent-yaml.service';
import type {AgentDefinition} from '@novel-master/core/agent';
import type {RootStackParamList} from '../../navigation/types';

import {AgentEditorBasicSection} from './agent-editor/AgentEditorBasicSection';
import {AgentEditorInvalidCard} from './agent-editor/AgentEditorInvalidCard';
import {AgentEditorModelSection} from './agent-editor/AgentEditorModelSection';
import {AgentEditorToolsSection} from './agent-editor/AgentEditorToolsSection';
import {PromptLayoutSection} from './agent-editor/PromptLayoutSection';
import {styles} from './agent-editor/agent-editor-form.styles';
import {AgentEditorFormState, useAgentEditorFormState} from './agent-editor/useAgentEditorFormState';
import {coreT} from '@/i18n/core';

type StackNav = NativeStackNavigationProp<RootStackParamList>;

type Props = {
    agentId: string;
    onDirtyChange?: (dirty: boolean) => void;
    onSaved?: () => void | Promise<void>;
    /**
   * 只读形态（内置 general sentinel）：以 initialDefinition 同步直填表单，
   * 跳过 registry 拉取；全部控件禁用灰显、不渲染保存栏，dirty 恒为 false
   * （savedBaseline 保持 null 且无输入通路，不会误报「有未保存的更改」）。
   */
    readOnly?: boolean;
    /** 只读形态的表单数据源（出厂定义常量）。 */
    initialDefinition?: AgentDefinition;
};

export function AgentEditorForm(props: Props) {
    // nm-style: keep-local — 五键解构单行化超 80 列；拆两行会牺牲可读性
    const {onDirtyChange, onSaved, agentId, readOnly = false, initialDefinition} = props;
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const navigation = useNavigation<StackNav>();
    const runtime = useRuntime();
    // MCP 工具快照（页面打开时刻经 AgentToolCatalog 组装 mcp 分组；spec §九）。
    const [mcpTools, setMcpTools] = useState<readonly AgentToolCatalogMcpTool[]>([]);

    // MCP 工具快照：页面打开时刻读一次 connection manager 缓存（spec §九移动端口径，
    // TTL 内命中缓存不发请求），失败静默回落「未配置」占位，不阻断 agent 编辑。
    // nm-style: keep-local — React hook：then/catch 链多行回调，单行化会破坏可读性
    useEffect(() => {
        runtime.mcp.connectionManager.snapshotTools().then(snapshots => setMcpTools(snapshots.map(entry => ({registeredName: McpToolSlug.toolName(entry.serverId, entry.toolName), serverName: entry.serverName, toolDescription: entry.toolDescription})))).catch(() => undefined);
    }, []);

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
    } = useAgentEditorFormState(agentId, runtime, showToast, initialDefinition);

    useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

    // 只读形态首帧即有数据（initialDefinition 直填），不走 registry 拉取。
    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
    useEffect(() => {
        if (readOnly) {
            return;
        }
        loadAgent().catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), err)));
    }, [loadAgent, showToast, readOnly]);

    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
    const handleDeleteBrokenAgent = useCallback(() => {
        Alert.alert(coreT({key: "ui.agent.delete_agent_title"}), coreT({key: "ui.agent.delete_agent_confirm_msg_named", params: {name: displayName ?? agentId}}), [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
                text: coreT({key: "ui.common.delete"}),
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        try {
                            const ids = await runtime.agentRegistry.listAgentIds();
                            if (ids.length <= 1) {
                                showToast(coreT({key: "ui.agent.min_one_agent"}));
                                return;
                            }
                            await runtime.agentRegistry.delete(agentId);
                            navigation.goBack();
                        } catch (error) {
                            showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), error));
                        }
                    })();
                },
            },
        ]);
    }, [agentId, displayName, navigation, runtime, showToast]);

    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
    const handleOverwriteDefault = useCallback(() => {
        // nm-style: keep-local — 确认文案是长中文串，外提成 const 会因宽度被 prettier 拆行
        Alert.alert(coreT({key: "ui.agent.template_overwrite_title"}), coreT({key: "ui.agent.template_overwrite_msg"}), [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
                text: coreT({key: "ui.agent.template_overwrite_confirm"}),
                onPress: () => {
                    void (async () => {
                        setRecovering(true);
                        try {
                            const raw = await runtime.agentRegistry.getRawWire(agentId);
                            const displayName = AgentEditorFormState.agentDisplayNameFromWire(raw, agentId);
                            const baseName = displayName.trim() || agentId;
                            const def = DefaultAgentDefinition.build(baseName);
                            const probe = new ToolRegistry();
                            BuiltinTools.register(probe);
                            await runtime.agentRegistry.upsert(agentId, def, {
                                registeredToolNames: probe.list(),
                            });
                            await loadAgent();
                            await onSaved?.();
                            showToast(coreT({key: "ui.agent.template_overwritten"}));
                        } catch (error) {
                            showToast(ToastMessage.toast(coreT({key: "ui.agent.overwrite_default_failed"}), error));
                        } finally {
                            setRecovering(false);
                        }
                    })();
                },
            },
        ]);
    }, [agentId, loadAgent, onSaved, runtime, setRecovering, showToast]);

    // nm-style: keep-local — 保存编排（构建 → 模型校验 → upsert → 基线/回调收尾）逾 20 行，
    // 内联进 StickyFormFooter 的 onPress 会把保存生命周期塞进 prop。
    const handleSave = async () => {
        const built = AgentEditorState.buildAgentDefinitionFromForm(form);
        if (!built.ok) {
            showToast(built.message);
            return;
        }
        let def = built.definition;
        if (form.modelEnabled) {
            if (!form.savedModelId) {
                showToast(coreT({key: "ui.agent.select_dedicated_model"}));
                return;
            }
            def = {...def, model: form.savedModelId};
        }
        setSaving(true);
        try {
            const probe = new ToolRegistry();
            BuiltinTools.register(probe);
            await runtime.agentRegistry.upsert(agentId, def, {
                registeredToolNames: probe.list(),
            });
            setSavedBaseline(snapshot);
            await onSaved?.();
            showToast(coreT({key: "ui.agent.saved_done"}));
        } catch (error) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), error));
        } finally {
            setSaving(false);
        }
    };

    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
    const handleExportYaml = useCallback(async () => {
        try {
            const result = await AgentYamlService.exportYaml(runtime, agentId);
            if (result === 'saved') {
                showToast(coreT({key: "ui.agent.yaml_exported"}));
            }
        } catch (error) {
            showToast(ToastMessage.toast(coreT({key: "ui.agent.export_yaml_failed"}), error));
        }
    }, [runtime, agentId, showToast]);

    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
    const handleImportYaml = useCallback(() => {
        Alert.alert(coreT({key: "ui.agent.import_yaml"}), coreT({key: "ui.agent.yaml_import_confirm"}), [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
                text: coreT({key: "ui.common.import"}),
                onPress: () => {
                    void (async () => {
                        try {
                            const imported = await AgentYamlService.importYaml(runtime, agentId);
                            if (!imported.ok) {
                                showToast(ToastMessage.toast(coreT({key: "ui.agent.import_yaml_failed"}), imported.error));
                                return;
                            }
                            await loadAgent();
                            showToast(coreT({key: "ui.agent.yaml_imported"}));
                        } catch (error) {
                            showToast(ToastMessage.toast(coreT({key: "ui.agent.import_yaml_failed"}), error));
                        }
                    })();
                },
            },
        ]);
    }, [runtime, agentId, loadAgent, showToast]);

    // 全屏编辑入口：回调先写进模块级存取再 push（路由参数必须可序列化，
    // 不再放函数），保存才用现有 setter 回填（自动触发 dirty，不另接线）。
    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
    const openPromptEditor = useCallback(
        (title: string, text: string, onSaved: (text: string) => void) => {
            promptEditorOnSavedSlot.set(onSaved);
            navigation.push('PromptEditor', {title, initialText: text});
        },
        [navigation],
    );

    if (loading) {
        return (
            <View style={styles.loadingWrap}>
                <Text style={{color: tokens.textSecondary}}>{coreT({key: "ui.common.loading"})}</Text>
            </View>
        );
    }

    if (loadError != null || invalidConfig != null) {
        const title = invalidConfig != null ? coreT(STORED_CONFIG_LABELS.invalidTitle) : coreT({key: "ui.common.load_failed"});
        let reason = loadError ?? '';
        if (invalidConfig != null) {
            reason = coreT(StoredConfigLabels.invalidReason(invalidConfig.code));
        }
        const detail = invalidConfig?.message ?? '';
        return (
            <AgentEditorInvalidCard
                tokens={tokens}
                title={title}
                reason={reason}
                detail={detail}
                recovering={recovering}
                onBack={() => navigation.goBack()}
                onOverwriteDefault={invalidConfig != null ? handleOverwriteDefault : undefined}
                onDelete={handleDeleteBrokenAgent}
            />
        );
    }

    return (
        <>
            {/* 只读横幅（内置 general）与未保存标记同一位置，样式同构（unsavedWrap）。 */}
            {readOnly ? (
                <View style={styles.unsavedWrap}>
                    <FormSectionCard tokens={tokens}>
                        <Text style={[styles.unsaved, {color: tokens.textSecondary}]}>{coreT({key: "ui.agent.builtin_note_mobile"})}</Text>
                    </FormSectionCard>
                </View>
            ) : null}
            {/* 未保存标记随 snapshot 同帧派生，避免跨组件 effect 通知在真机转场下刷新不及时 */}
            {isDirty ? (
                <View style={styles.unsavedWrap}>
                    <FormSectionCard tokens={tokens}>
                        <Text style={[styles.unsaved, {color: tokens.danger}]}>{coreT({key: "ui.common.unsaved_changes"})}</Text>
                    </FormSectionCard>
                </View>
            ) : null}
            <ScreenFormLayout tokens={tokens} footer={readOnly ? undefined : <StickyFormFooter tokens={tokens} label={coreT({key: "ui.common.save"})} loading={saving} onPress={() => handleSave().catch(() => undefined)} />}>
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
                    readOnly={readOnly}
                />

                <AgentEditorModelSection tokens={tokens} value={form.modelEnabled ? form.savedModelId : ''} onChange={handleModelSelect} options={modelSelectOptions} readOnly={readOnly} />

                <FormSectionCard title={coreT({key: "ui.agent.runtime_section"})} tokens={tokens}>
                    <FormField label={PROMPT_REGION_LABELS.maxStepsLabel} tokens={tokens} hint={PROMPT_REGION_LABELS.maxStepsHint}>
                        <FormTextInput tokens={tokens} value={form.maxSteps} onChangeText={value => patch({maxSteps: value})} keyboardType="number-pad" disabled={readOnly} />
                    </FormField>
                </FormSectionCard>

                <AgentEditorToolsSection
                    tokens={tokens}
                    toolsMode={form.toolsMode}
                    onToolsModeChange={value => patch({toolsMode: value})}
                    toolsSelected={form.toolsSelected}
                    onToolsSelectedChange={value => patch({toolsSelected: value})}
                    mcpTools={mcpTools}
                    readOnly={readOnly}
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
                    readOnly={readOnly}
                />
            </ScreenFormLayout>
        </>
    );
}
