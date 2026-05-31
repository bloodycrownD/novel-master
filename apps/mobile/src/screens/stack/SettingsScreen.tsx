/**
 * App UI preferences + session FS version check.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {appUiKeys} from '../../storage/app-ui-prefs';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';

export function SettingsScreen() {
  const {tokens} = useTheme();
  const {appUi} = useNovelMaster();
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [enableVfs, setEnableVfs] = useState(true);
  const [checkpointRetention, setCheckpointRetention] = useState('100');
  const [showFullToolParams, setShowFullToolParams] = useState(false);
  const [autoFixJson, setAutoFixJson] = useState(true);
  const [sessionFsVersionCheck, setSessionFsVersionCheck] = useState(true);

  const load = useCallback(async () => {
    if (!appUi) {
      return;
    }
    setLoading(true);
    try {
      const [vfs, retention, toolParams, fixJson, versionCheck] =
        await Promise.all([
          appUi.get(appUiKeys.enableVfs),
          appUi.get(appUiKeys.checkpointRetention),
          appUi.get(appUiKeys.showFullToolParams),
          appUi.get(appUiKeys.autoFixJson),
          runtime.preferences.getSessionFsVersionCheck(),
        ]);
      setEnableVfs(vfs !== 'false');
      setCheckpointRetention(retention ?? '100');
      setShowFullToolParams(toolParams === 'true');
      setAutoFixJson(fixJson !== 'false');
      setSessionFsVersionCheck(versionCheck);
    } finally {
      setLoading(false);
    }
  }, [appUi, runtime]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const persistUi = async (key: string, value: string) => {
    if (!appUi) {
      return;
    }
    await appUi.set(key, value);
  };

  const handleVfs = async (value: boolean) => {
    setEnableVfs(value);
    try {
      await persistUi(appUiKeys.enableVfs, value ? 'true' : 'false');
    } catch (error) {
      Alert.alert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleRetention = async (value: string) => {
    setCheckpointRetention(value);
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) {
      return;
    }
    try {
      await persistUi(appUiKeys.checkpointRetention, String(Math.min(500, Math.max(1, Math.round(n)))));
    } catch (error) {
      Alert.alert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleToolParams = async (value: boolean) => {
    setShowFullToolParams(value);
    try {
      await persistUi(appUiKeys.showFullToolParams, value ? 'true' : 'false');
    } catch (error) {
      Alert.alert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleAutoFix = async (value: boolean) => {
    setAutoFixJson(value);
    try {
      await persistUi(appUiKeys.autoFixJson, value ? 'true' : 'false');
    } catch (error) {
      Alert.alert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleVersionCheck = async (value: boolean) => {
    setSessionFsVersionCheck(value);
    try {
      await runtime.preferences.setSessionFsVersionCheck(value);
    } catch (error) {
      Alert.alert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <ScrollView
      style={[styles.root, {backgroundColor: tokens.background}]}
      contentContainerStyle={styles.scroll}>
      <View style={[styles.group, {borderColor: tokens.border}]}>
        <Text style={[styles.groupTitle, {color: tokens.textSecondary}]}>
          虚拟文件
        </Text>
        <View style={styles.row}>
          <Text style={{color: tokens.text, flex: 1}}>启用虚拟文件系统</Text>
          <Switch
            value={enableVfs}
            onValueChange={v => handleVfs(v).catch(() => undefined)}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>
        <View style={styles.row}>
          <Text style={{color: tokens.text, flex: 1}}>
            Session FS 版本检查
          </Text>
          <Switch
            value={sessionFsVersionCheck}
            onValueChange={v =>
              handleVersionCheck(v).catch(() => undefined)
            }
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>
      </View>

      <View style={[styles.group, {borderColor: tokens.border}]}>
        <Text style={[styles.groupTitle, {color: tokens.textSecondary}]}>
          检查点
        </Text>
        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          保留检查点数量
        </Text>
        <TextInput
          style={[
            styles.input,
            {color: tokens.text, borderColor: tokens.border},
          ]}
          value={checkpointRetention}
          onChangeText={handleRetention}
          keyboardType="number-pad"
        />
      </View>

      <View style={[styles.group, {borderColor: tokens.border}]}>
        <Text style={[styles.groupTitle, {color: tokens.textSecondary}]}>
          工具
        </Text>
        <View style={styles.row}>
          <Text style={{color: tokens.text, flex: 1}}>显示完整工具参数</Text>
          <Switch
            value={showFullToolParams}
            onValueChange={v =>
              handleToolParams(v).catch(() => undefined)
            }
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>
        <View style={styles.row}>
          <Text style={{color: tokens.text, flex: 1}}>自动修复 JSON</Text>
          <Switch
            value={autoFixJson}
            onValueChange={v => handleAutoFix(v).catch(() => undefined)}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loader: {marginTop: 32},
  scroll: {padding: 16, gap: 16},
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  groupTitle: {fontSize: 13, fontWeight: '600', textTransform: 'uppercase'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {fontSize: 13},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
