/**
 * Edit provider fields + rotate SKSP api key (§14 M6).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {
  ProviderForm,
  providerFormToEditPatch,
  type ProviderFormValues,
} from '../../components/provider/ProviderForm';
import {useRuntime} from '../../hooks/useRuntime';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type EditRoute = RouteProp<RootStackParamList, 'ProviderEdit'>;

export function ProviderEditScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const route = useRoute<EditRoute>();
  const providerId = route.params?.providerId;
  const {setStackOverride} = useHeaderContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initial, setInitial] = useState<Partial<ProviderFormValues>>();
  const [isBuiltin, setIsBuiltin] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<'set' | 'not set'>(
    'not set',
  );

  const load = useCallback(async () => {
    if (!providerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const provider = await runtime.providers.get(providerId);
      const listed = (await runtime.providers.list()).find(p => p.id === providerId);
      setStackOverride({
        title: `编辑 ${provider.displayName?.trim() || provider.id}`,
      });
      setIsBuiltin(provider.isBuiltin);
      setApiKeyStatus(listed?.apiKeyStatus ?? 'not set');
      setInitial({
        id: provider.id,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        displayName: provider.displayName ?? '',
        headersJson:
          Object.keys(provider.headers).length > 0
            ? JSON.stringify(provider.headers)
            : '',
        apiKey: '',
      });
    } catch (error) {
      showToast(toastMessage('加载失败', error));
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [runtime, providerId, navigation, setStackOverride, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
    return () => setStackOverride(undefined);
  }, [load, setStackOverride]);

  useEffect(() => {
    if (!providerId) {
      showToast(toastMessage('错误', '缺少 providerId'));
      navigation.goBack();
    }
  }, [providerId, navigation, showToast]);

  if (loading || !initial || !providerId) {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <ActivityIndicator style={styles.loader} />
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {isBuiltin ? (
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>
          内置服务商不可修改协议。
        </Text>
      ) : null}
      <ProviderForm
        mode="edit"
        initial={initial}
        isBuiltin={isBuiltin}
        apiKeyStatus={apiKeyStatus}
        saving={saving}
        onSubmit={async values => {
          setSaving(true);
          try {
            const patch = providerFormToEditPatch(values);
            if (!isBuiltin && values.protocol !== initial.protocol) {
              await runtime.providers.edit(providerId, {
                ...patch,
                protocol: values.protocol,
              });
            } else {
              await runtime.providers.edit(providerId, patch);
            }
            showToast('已保存');
            navigation.goBack();
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
  loader: {marginTop: 32},
  hint: {paddingHorizontal: 16, paddingTop: 12, fontSize: 13},
});
