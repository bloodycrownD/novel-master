/**
 * Project picker drawer (modal shell; M1 lists projects from runtime).
 */
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {ChatProject} from '@novel-master/core';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  projects: ChatProject[];
  currentProjectId: string | undefined;
  onClose: () => void;
  onSelect: (projectId: string) => void;
  onCreate: () => void;
};

export function ProjectDrawer({
  visible,
  projects,
  currentProjectId,
  onClose,
  onSelect,
  onCreate,
}: Props) {
  const {tokens} = useTheme();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.panel, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.heading, {color: tokens.text}]}>项目</Text>
          <ScrollView>
            {projects.map(p => (
              <Pressable
                key={p.id}
                style={styles.row}
                onPress={() => {
                  onSelect(p.id);
                  onClose();
                }}>
                <Text style={{color: tokens.text}}>
                  {p.name}
                  {p.id === currentProjectId ? ' · 当前' : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={onCreate} style={styles.row}>
            <Text style={{color: tokens.primary}}>新建项目</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-start',
  },
  panel: {
    marginTop: 56,
    maxHeight: '80%',
    padding: 16,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  heading: {fontSize: 18, fontWeight: '600', marginBottom: 12},
  row: {paddingVertical: 12},
});
