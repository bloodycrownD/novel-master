/**
 * 模型选择器：同时服务「我的」tab（workspace 全局）与会话详情页（session 覆盖）。
 *
 * 传入 `sessionId` 时走会话级路径——`selectedId` 取 session 绑定 modelId。
 * session 模式不回退 workspace：`modelId` 为空时 picker 不高亮任何项，
 * 避免误导用户以为这个会话已经绑了模型。选中后写 `{ modelId }` patch（保持现有 mode/agentId）。
 * 不传时维持原 workspace 行为。骨架（加载/错误重试/空态/列表）由 PickerListModal 承担。
 */
import React, {useCallback} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {SavedModelDisplayName} from '@novel-master/core/provider';
import {Result, AppError} from '@novel-master/core/errors';
import {useRuntime} from '../../hooks/useRuntime';
import {ToastMessage} from '../../errors/toast-message';
import {useToast} from '../chrome/ToastHost';
import {useTheme} from '../../theme/ThemeProvider';
import {PickerListModal, type PickerListLoadResult} from '../ui/PickerListModal';
import {ModelKey} from '../../utils/model-key';
import {coreT} from '../../i18n/core';

interface SavedModelRow {
  readonly savedModelId: string;
  readonly label: string;
  readonly subtitle?: string;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelected?: (savedModelId: string) => void;
  /**
   * 传入后会话级分流：读 session 绑定 modelId 作为当前选中，写 session override。
   * 不传则维持 workspace 全局行为（「我的」tab）。
   */
  sessionId?: string;
};

export function ModelPickerModal({visible, onClose, onSelected, sessionId}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();

  const load = useCallback(async (): Promise<Result<PickerListLoadResult<SavedModelRow>, AppError>> => {
    let selectedId: string | undefined;
    if (sessionId != null) {
      // 会话级：只用 session 自己绑定的 modelId 高亮。即便为空，
      // 也不再回退 workspace 当前模型——否则用户会以为会话已经绑定了模型。
      const sessionConfig = await runtime.sessions.getSessionAgentConfig(sessionId);
      if (!sessionConfig.ok) return Result.err(sessionConfig.error);
      selectedId = sessionConfig.value.modelId && sessionConfig.value.modelId.length > 0 ? sessionConfig.value.modelId : undefined;
    } else {
      // workspace 全局：用 workspace 当前模型高亮。
      const workspaceModel = await runtime.state.getCurrentModelId();
      if (!workspaceModel.ok) return Result.err(workspaceModel.error);
      selectedId = workspaceModel.value ?? undefined;
    }
    const loadedProviders = await runtime.providers.list();
    if (!loadedProviders.ok) return Result.err(loadedProviders.error);
    const providers = loadedProviders.value;
    const nameById = new Map(providers.map(provider => [provider.id, provider.displayName]));
    const allModels: Array<{
      id: string;
      providerId: string;
      modelName: string;
      vendorModelId: string;
    }> = [];
    for (const provider of providers) {
      const saved = await runtime.providerModels.savedList(provider.id);
      if (!saved.ok) return Result.err(saved.error);
      for (const model of saved.value) {
        allModels.push({
          id: model.id,
          providerId: model.providerId,
          modelName: model.modelName,
          vendorModelId: model.vendorModelId,
        });
      }
    }
    const nameCounts = new Map<string, number>();
    for (const model of allModels) {
      const key = ModelKey.name(model.providerId, model.modelName);
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    const collected: SavedModelRow[] = allModels.map(model => {
      const duplicate = (nameCounts.get(ModelKey.name(model.providerId, model.modelName)) ?? 0) > 1;
      const providerDisplayName = nameById.get(model.providerId) ?? coreT({key: "ui.provider.unknown_provider"});
      return {
        savedModelId: model.id,
        label: SavedModelDisplayName.format(providerDisplayName, model.modelName),
        subtitle: duplicate ? model.vendorModelId : undefined,
      };
    });
    collected.sort((a, b) => a.label.localeCompare(b.label));
    return Result.ok({rows: collected, selectedId});
  }, [runtime, sessionId]);

  const select = useCallback(
    async (savedModelId: string) => {
      // 分流：session 写全量配置（保留 agentId 只换 modelId），workspace 写全局。
      // 写入成功才回调并关闭；失败留在弹窗里 toast 提示，方便重试。
      try {
        if (sessionId != null) {
          const current = await runtime.sessions.getSessionAgentConfig(sessionId);
          if (!current.ok) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.set_failed"}), current.error));
            return;
          }
          const updated = await runtime.sessions.updateSessionAgentConfig(sessionId, {agentId: current.value.agentId, modelId: savedModelId});
          if (!updated.ok) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.set_failed"}), updated.error));
            return;
          }
        } else {
          const updated = await runtime.state.setCurrentModelId(savedModelId);
          if (!updated.ok) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.set_failed"}), updated.error));
            return;
          }
        }
      } catch (cause) {
        showToast(ToastMessage.toast(coreT({key: "ui.common.set_failed"}), cause));
        return;
      }
      onSelected?.(savedModelId);
      onClose();
    },
    [runtime, sessionId, onSelected, onClose, showToast],
  );

  return (
    <PickerListModal
      visible={visible}
      title={coreT({key: "ui.chat.select_model_title"})}
      load={load}
      keyExtractor={item => item.savedModelId}
      renderRow={(item, selected) => (
        <>
          <View style={styles.rowText}>
            <Text style={{color: tokens.text}}>{item.label}</Text>
            {item.subtitle ? <Text style={[styles.subtitle, {color: tokens.textSecondary}]}>{item.subtitle}</Text> : null}
          </View>
          {selected ? <Text style={{color: tokens.primary}}>{coreT({key: "ui.common.current"})}</Text> : null}
        </>
      )}
      onPick={item => select(item.savedModelId)}
      emptyText={coreT({key: "ui.chat.no_saved_models"})}
      onClose={onClose}
    />
  );
}

const styles = StyleSheet.create({
  rowText: {flex: 1, gap: 2},
  subtitle: {fontSize: 12},
});
