/**
 * Create custom provider + SKSP api key (§14 M6).
 */
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ProviderForm,
  providerFormToCreateInput,
} from '../../components/provider/ProviderForm';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ProviderCreateScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [saving, setSaving] = useState(false);

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ProviderForm
        mode="create"
        saving={saving}
        onSubmit={async values => {
          setSaving(true);
          try {
            const input = providerFormToCreateInput(values);
            await runtime.providers.create(input);
            if (__DEV__) {
              console.info('[ProviderCreate] created', input.id);
            }
            showToast(`已创建服务商：${input.displayName?.trim() || input.id}`);
            navigation.replace('ProviderDetail', {providerId: input.id});
          } catch (err) {
            showToast(toastMessage('创建失败', err));
          } finally {
            setSaving(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
