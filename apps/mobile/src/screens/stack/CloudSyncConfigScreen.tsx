/**
 * 云存储配置表单：Endpoint、Bucket、AK/SK、路径前缀与测试连接。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {CloudSyncConfigStore, DEFAULT_CLOUD_SYNC_PATH_PREFIX} from '@/services/cloud-sync-config.store';
import {CloudSyncService, type CloudSyncConfigInput} from '@/services/cloud-sync.service';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormSwitchRow} from '@/components/form/FormSwitchRow';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';

type FormState = {
  endpoint: string;
  bucket: string;
  region: string;
  pathPrefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  deviceLabel: string;
};

const EMPTY_FORM: FormState = {
  endpoint: '',
  bucket: '',
  region: '',
  pathPrefix: DEFAULT_CLOUD_SYNC_PATH_PREFIX,
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: false,
  deviceLabel: '',
};

export function CloudSyncConfigScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [secretKeySet, setSecretKeySet] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    const config = await CloudSyncConfigStore.get(runtime);
    if (config.ok) {
      setSecretKeySet(config.value.secretKeySet);
      setForm({
        endpoint: config.value.endpoint,
        bucket: config.value.bucket,
        region: config.value.region,
        pathPrefix: config.value.pathPrefix || DEFAULT_CLOUD_SYNC_PATH_PREFIX,
        accessKeyId: config.value.accessKeyId,
        secretAccessKey: '',
        forcePathStyle: config.value.forcePathStyle,
        deviceLabel: config.value.deviceLabel ?? '',
      });
    } else {
      showToast(ToastMessage.toast(coreT({key: "ui.cloud_sync.load_config_failed"}), config.error));
    }
    setLoading(false);
  }, [runtime, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const toInput = (): CloudSyncConfigInput => ({
    endpoint: form.endpoint,
    bucket: form.bucket,
    region: form.region,
    pathPrefix: form.pathPrefix,
    accessKeyId: form.accessKeyId,
    secretAccessKey: form.secretAccessKey,
    forcePathStyle: form.forcePathStyle,
    deviceLabel: form.deviceLabel.trim() || undefined,
  });

  const handleTest = async () => {
    if (testing || saving) {
      return;
    }
    setTesting(true);
    try {
      const tested = await CloudSyncService.testConnection(runtime, toInput());
      if (!tested.ok) {
        showToast(ToastMessage.toast(coreT({key: "ui.common.connect_failed"}), tested.error));
        return;
      }
      showToast(coreT({key: "ui.cloud_sync.connected_done"}));
    } catch (error) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.connect_failed"}), error));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (saving || testing) {
      return;
    }
    if (!form.secretAccessKey.trim() && !secretKeySet) {
      showToast(coreT({key: "ui.cloud_sync.secret_required"}));
      return;
    }
    setSaving(true);
    try {
      const input = toInput();
      if (!input.secretAccessKey?.trim() && secretKeySet) {
        const existing = await runtime.secretStore.get('cloud-sync/s3-secret-key');
        if (!existing) {
          showToast(coreT({key: "ui.cloud_sync.secret_required"}));
          return;
        }
        input.secretAccessKey = existing;
      }
      const saved = await CloudSyncConfigStore.set(runtime, input);
      if (!saved.ok) {
        showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), saved.error));
        return;
      }
      setSecretKeySet(true);
      setForm(prev => ({...prev, secretAccessKey: ''}));
      showToast(coreT({key: "ui.cloud_sync.config_saved"}));
    } catch (error) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, {backgroundColor: tokens.background}]}>
        <ActivityIndicator color={tokens.primary} />
      </View>
    );
  }

  return (
    <ScreenFormLayout
      tokens={tokens}
      footer={
        <StickyFormFooter
          tokens={tokens}
          label={coreT({key: "ui.cloud_sync.save_config"})}
          onPress={() => {
            handleSave().catch(() => undefined);
          }}
          loading={saving}
          disabled={testing}
        />
      }
    >
      <FormSectionCard tokens={tokens} title={coreT({key: "ui.cloud_sync.s3_section"})}>
        <FormField label="Endpoint" tokens={tokens} hint={coreT({key: "ui.cloud_sync.endpoint_hint"})}>
          <FormTextInput
            tokens={tokens}
            value={form.endpoint}
            onChangeText={endpoint => setForm(prev => ({...prev, endpoint}))}
            placeholder="https://s3.example.com"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
        <FormField label="Bucket" tokens={tokens}>
          <FormTextInput tokens={tokens} value={form.bucket} onChangeText={bucket => setForm(prev => ({...prev, bucket}))} autoCapitalize="none" autoCorrect={false} />
        </FormField>
        <FormField label="Region" tokens={tokens} hint="MinIO 可留空">
          <FormTextInput tokens={tokens} value={form.region} onChangeText={region => setForm(prev => ({...prev, region}))} autoCapitalize="none" autoCorrect={false} />
        </FormField>
        <FormField label={coreT({key: "ui.cloud_sync.prefix_label"})} tokens={tokens} hint={coreT({key: "ui.cloud_sync.prefix_hint"})}>
          <FormTextInput tokens={tokens} value={form.pathPrefix} onChangeText={pathPrefix => setForm(prev => ({...prev, pathPrefix}))} autoCapitalize="none" autoCorrect={false} />
        </FormField>
        <FormSwitchRow
          label="Path style"
          description={coreT({key: "ui.cloud_sync.path_style_hint"})}
          tokens={tokens}
          value={form.forcePathStyle}
          onValueChange={forcePathStyle => setForm(prev => ({...prev, forcePathStyle}))}
        />
      </FormSectionCard>

      <FormSectionCard tokens={tokens} title={coreT({key: "ui.cloud_sync.credentials_section"})}>
        <FormField label="Access Key ID" tokens={tokens}>
          <FormTextInput tokens={tokens} value={form.accessKeyId} onChangeText={accessKeyId => setForm(prev => ({...prev, accessKeyId}))} autoCapitalize="none" autoCorrect={false} />
        </FormField>
        <FormField label="Secret Access Key" tokens={tokens} hint={secretKeySet ? coreT({key: "ui.cloud_sync.secret_saved_hint"}) : coreT({key: "ui.cloud_sync.secret_create_hint"})}>
          <FormTextInput
            tokens={tokens}
            value={form.secretAccessKey}
            onChangeText={secretAccessKey => setForm(prev => ({...prev, secretAccessKey}))}
            placeholder={secretKeySet ? coreT({key: "ui.cloud_sync.secret_placeholder"}) : ''}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
        <FormField label={coreT({key: "ui.cloud_sync.device_label"})} tokens={tokens}>
          <FormTextInput tokens={tokens} value={form.deviceLabel} onChangeText={deviceLabel => setForm(prev => ({...prev, deviceLabel}))} placeholder={coreT({key: "ui.cloud_sync.device_hint"})} />
        </FormField>
        <SecondaryButton
          tokens={tokens}
          fullWidth
          label={testing ? coreT({key: "ui.cloud_sync.testing"}) : coreT({key: "ui.cloud_sync.test_connection"})}
          onPress={() => {
            handleTest().catch(() => undefined);
          }}
          disabled={testing || saving}
        />
        <Text style={[styles.note, {color: tokens.textTertiary}]}>{coreT({key: "ui.cloud_sync.test_note"})}</Text>
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  centered: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  note: {fontSize: 12, lineHeight: 18, marginTop: 4},
});
