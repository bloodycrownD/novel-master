/**
 * Workspace agent picker: lists registry agents and sets PersistentState current agent.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import {useRuntime} from '../../hooks/useRuntime';
import {AppModal} from '../ui/AppModal';
import {
  AGENT_PICKER_EMPTY_MESSAGE,
  isAgentPickerRowSelected,
  loadAgentPickerRows,
  selectWorkspaceAgent,
  type AgentPickerRow,
} from '../../services/agent-picker';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelected?: (agentId: string) => void;
};

export function AgentPickerModal({visible, onClose, onSelected}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [rows, setRows] = useState<AgentPickerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentId, setCurrentId] = useState<string | undefined>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadAgentPickerRows(runtime);
      setCurrentId(loaded.currentId);
      setRows(loaded.rows);
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    if (visible) {
      reload().catch(() => setRows([]));
    }
  }, [visible, reload]);

  const select = useCallback(
    async (agentId: string) => {
      await selectWorkspaceAgent(runtime, agentId);
      onSelected?.(agentId);
      onClose();
    },
    [runtime, onSelected, onClose],
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
