/**
 * Agent 选择器：同时服务「我的」tab（workspace 全局）与会话详情页（session 绑定）。
 *
 * 传入 `sessionId` 时走会话级路径——读 `loadSessionAgentPickerRows`，
 * 写 `selectSessionAgent`（不动 workspace 全局指针）；不传时维持原 workspace 行为。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useRuntime} from '../../hooks/useRuntime';
import {formatError} from '../../errors/format-error';
import {toastMessage} from '../../errors/toast-message';
import {useToast} from '../chrome/ToastHost';
import {AppModal} from '../ui/AppModal';
import {
  AGENT_PICKER_EMPTY_MESSAGE,
  isAgentPickerRowSelected,
  loadAgentPickerRows,
  loadSessionAgentPickerRows,
  selectWorkspaceAgent,
  selectSessionAgent,
  type AgentPickerRow,
} from '../../services/agent-picker';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelected?: (agentId: string) => void;
  /**
   * 传入后会话级分流：读 session 绑定作为当前选中，写 selectSessionAgent。
   * 不传则维持 workspace 全局行为（「我的」tab）。
   */
  sessionId?: string;
};

export function AgentPickerModal({visible, onClose, onSelected, sessionId}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [rows, setRows] = useState<AgentPickerRow[]>([]);
  const [loading, setLoading] = useState(false);
  // 加载失败渲染错误文案 + 重试，而不是吞错伪装成空列表（对齐 FetchModelsSheet）。
  const [error, setError] = useState<string | undefined>();
  const [currentId, setCurrentId] = useState<string | undefined>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      // 有 sessionId 走会话级（绑定优先、缺失回退 workspace）；否则读 workspace 全局。
      const loaded =
        sessionId != null
          ? await loadSessionAgentPickerRows(runtime, sessionId)
          : await loadAgentPickerRows(runtime);
      setCurrentId(loaded.currentId);
      setRows(loaded.rows);
    } catch (cause) {
      setRows([]);
      setError(formatError(cause));
    } finally {
      setLoading(false);
    }
  }, [runtime, sessionId]);

  useEffect(() => {
    if (visible) {
      reload().catch(() => undefined);
    }
  }, [visible, reload]);

  const select = useCallback(
    async (agentId: string) => {
      // 分流：session 绑定只影响单个会话；workspace 入口继续写全局指针。
      // 写入成功才回调并关闭；失败留在弹窗里 toast 提示，方便重试。
      try {
        if (sessionId != null) {
          await selectSessionAgent(runtime, sessionId, agentId);
        } else {
          await selectWorkspaceAgent(runtime, agentId);
        }
      } catch (cause) {
        showToast(toastMessage('设置失败', cause));
        return;
      }
      onSelected?.(agentId);
      onClose();
    },
    [runtime, sessionId, onSelected, onClose, showToast],
  );

  return (
    <AppModal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>选择 Agent</Text>
          {loading ? (
            <ActivityIndicator style={styles.loader} />
          ) : error ? (
            <View style={styles.center}>
              <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
              <Pressable onPress={() => reload().catch(() => undefined)}>
                <Text style={{color: tokens.primary, fontWeight: '600'}}>
                  重试
                </Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={item => item.agentId}
              ListEmptyComponent={
                <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                  {AGENT_PICKER_EMPTY_MESSAGE}
                </Text>
              }
              renderItem={({item, index}) => {
                const selected = isAgentPickerRowSelected(
                  item.agentId,
                  index,
                  currentId,
                );
                return (
                  <Pressable
                    style={[
                      styles.row,
                      {borderBottomColor: tokens.border},
                      selected && {backgroundColor: tokens.background},
                    ]}
                    onPress={() => select(item.agentId)}>
                    <Text style={{color: tokens.text, flex: 1}}>
                      {item.label}
                    </Text>
                    {selected ? (
                      <Text style={{color: tokens.primary}}>当前</Text>
                    ) : null}
                  </Pressable>
                );
              }}
            />
          )}
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={{color: tokens.textSecondary}}>取消</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  loader: {marginVertical: 24},
  center: {alignItems: 'center', gap: 12, padding: 24},
  error: {textAlign: 'center', lineHeight: 20},
  empty: {textAlign: 'center', padding: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  cancelBtn: {alignItems: 'center', paddingTop: 12},
});
