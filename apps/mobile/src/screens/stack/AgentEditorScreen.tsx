/**
 * Full-screen agent editor (stack route).
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {AgentEditorForm} from '../../components/agent/AgentEditorForm';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {useUnsavedGuard} from '../../hooks/useUnsavedGuard';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type EditorRoute = RouteProp<RootStackParamList, 'AgentEditor'>;

export function AgentEditorScreen() {
  const {tokens} = useTheme();
  const route = useRoute<EditorRoute>();
  const agentId = route.params?.agentId;
  const [dirty, setDirty] = useState(false);

  useUnsavedGuard(dirty);

  if (!agentId) {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <Text style={{color: tokens.textSecondary, padding: 16}}>
          缺少 agentId
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {dirty ? (
        <View style={styles.unsavedWrap}>
          <FormSectionCard tokens={tokens}>
            <Text style={[styles.unsaved, {color: tokens.danger}]}>
              有未保存的更改
            </Text>
          </FormSectionCard>
        </View>
      ) : null}
      <AgentEditorForm
        agentId={agentId}
        onDirtyChange={setDirty}
        onSaved={() => setDirty(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  unsavedWrap: {marginHorizontal: 5, paddingTop: 8},
  unsaved: {fontSize: 14, fontWeight: '600'},
});
