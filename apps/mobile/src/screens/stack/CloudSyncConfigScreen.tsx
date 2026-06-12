/**
 * 云存储配置表单：Endpoint、Bucket、AK/SK、路径前缀与测试连接。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {DEFAULT_CLOUD_SYNC_PATH_PREFIX} from '../../services/cloud-sync-config.store';
import {
  getCloudSyncConfig,
  setCloudSyncConfig,
  testCloudSyncConnection,
  type CloudSyncConfigInput,
} from '../../services/cloud-sync.service';
import {FormField} from '../../components/form/FormField';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormSwitchRow} from '../../components/form/FormSwitchRow';
import {FormTextInput} from '../../components/form/FormTextInput';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
import {SecondaryButton} from '../../components/ui/PrototypeButtons';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

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
  forcePathStyle: true,
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
    try {
      const config = await getCloudSyncConfig(runtime);
      setSecretKeySet(config.secretKeySet);
      setForm({
        endpoint: config.endpoint,
        bucket: config.bucket,
        region: config.region,
        pathPrefix: config.pathPrefix || DEFAULT_CLOUD_SYNC_PATH_PREFIX,
        accessKeyId: config.accessKeyId,
        secretAccessKey: '',
        forcePathStyle: config.forcePathStyle,
        deviceLabel: config.deviceLabel ?? '',
      });
    } catch (error) {
      showToast(toastMessage('加载云同步配置失败', error));
    } finally {
      setLoading(false);
    }
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
      await testCloudSyncConnection(runtime, toInput());
      showToast('连接成功');
    } catch (error) {
      showToast(toastMessage('连接失败', error));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (saving || testing) {
      return;
    }
    if (!form.secretAccessKey.trim() && !secretKeySet) {
      showToast('请填写 Secret Key');
      return;
    }
    setSaving(true);
    try {
      const input = toInput();
      if (!input.secretAccessKey.trim() && secretKeySet) {
        const existing = await runtime.secretStore.get(
          'cloud-sync/s3-secret-key',
        );
        if (!existing) {
          showToast('请填写 Secret Key');
          return;
        }
        input.secretAccessKey = existing;
      }
      await setCloudSyncConfig(runtime, input);
      setSecretKeySet(true);
      setForm(prev => ({...prev, secretAccessKey: ''}));
      showToast('配置已保存');
    } catch (error) {
      showToast(toastMessage('保存失败', error));
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
          label="保存配置"
          onPress={() => {
            handleSave().catch(() => undefined);
          }}
          loading={saving}
          disabled={testing}
        />
      }>
      <FormSectionCard tokens={tokens} title="S3 兼容存储">
        <FormField label="Endpoint" tokens={tokens} hint="含 https://">
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
          <FormTextInput
            tokens={tokens}
            value={form.bucket}
            onChangeText={bucket => setForm(prev => ({...prev, bucket}))}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
        <FormField label="Region" tokens={tokens} hint="MinIO 可留空">
          <FormTextInput
            tokens={tokens}
            value={form.region}
            onChangeText={region => setForm(prev => ({...prev, region}))}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
        <FormField label="路径前缀" tokens={tokens} hint="须以 / 结尾，保存时自动规范化">
          <FormTextInput
            tokens={tokens}
            value={form.pathPrefix}
            onChangeText={pathPrefix => setForm(prev => ({...prev, pathPrefix}))}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
        <FormSwitchRow
          label="Path style"
          description="MinIO 与部分 OSS 需开启"
          tokens={tokens}
          value={form.forcePathStyle}
          onValueChange={forcePathStyle =>
            setForm(prev => ({...prev, forcePathStyle}))
          }
        />
      </FormSectionCard>

      <FormSectionCard tokens={tokens} title="凭据">
        <FormField label="Access Key ID" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={form.accessKeyId}
            onChangeText={accessKeyId =>
              setForm(prev => ({...prev, accessKeyId}))
            }
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
        <FormField
          label="Secret Access Key"
          tokens={tokens}
          hint={secretKeySet ? '已保存；留空则保留原密钥' : '保存时写入 SKSP'}>
          <FormTextInput
            tokens={tokens}
            value={form.secretAccessKey}
            onChangeText={secretAccessKey =>
              setForm(prev => ({...prev, secretAccessKey}))
            }
            placeholder={secretKeySet ? '留空保留已存密钥' : ''}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
        <FormField label="设备名称（可选）" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={form.deviceLabel}
            onChangeText={deviceLabel =>
              setForm(prev => ({...prev, deviceLabel}))
            }
            placeholder="便于识别本机"
          />
        </FormField>
      </FormSectionCard>

      <View style={styles.testRow}>
        <SecondaryButton
          tokens={tokens}
          label={testing ? '测试中…' : '测试连接'}
          onPress={() => {
            handleTest().catch(() => undefined);
          }}
          disabled={testing || saving}
        />
      </View>

      <Text style={[styles.note, {color: tokens.textTertiary}]}>
        测试连接仅校验桶访问权限，不会执行拉取或推送。
      </Text>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  centered: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  testRow: {paddingHorizontal: 16, marginTop: 8},
  note: {fontSize: 12, lineHeight: 18, paddingHorizontal: 16, marginTop: 8},
});
