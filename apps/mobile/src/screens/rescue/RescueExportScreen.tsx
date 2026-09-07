/**
 * 救援模式唯一界面：数据库导出。
 *
 * 毒数据（如巨型角色卡）落库后常规启动链会在会话上下文组装上原生 OOM，
 * 本屏不挂载任何导航/会话 UI，崩溃链永远不执行；导出走 checkpoint + 文件级
 * 拷贝 + 清服务商表，不解析正文，对毒数据免疫。导出成功后用户应卸载本
 * 救援包、安装正式版并导入 .nmbackup。
 *
 * @module screens/rescue/RescueExportScreen
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {exportDatabaseBackup} from '../../services/db-backup.service';

type ExportPhase = 'idle' | 'exporting' | 'saved' | 'failed';

export function RescueExportScreen() {
  const {status, runtime, error, retry} = useNovelMaster();
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [phaseMessage, setPhaseMessage] = useState<string>('');

  const onExport = useCallback(async () => {
    if (runtime == null) {
      return;
    }
    setPhase('exporting');
    setPhaseMessage('');
    try {
      const outcome = await exportDatabaseBackup(runtime);
      if (outcome === 'cancelled') {
        setPhase('idle');
        return;
      }
      setPhase('saved');
      setPhaseMessage('数据库已导出。请妥善保管备份文件。');
    } catch (err) {
      setPhase('failed');
      setPhaseMessage(err instanceof Error ? err.message : String(err));
    }
  }, [runtime]);

  const colors = {
    background: dark ? '#111318' : '#f7f8fa',
    card: dark ? '#1d2026' : '#ffffff',
    text: dark ? '#e8eaed' : '#1b1d22',
    subtext: dark ? '#9aa0aa' : '#5f646e',
    button: '#3b6ef5',
    buttonText: '#ffffff',
    danger: dark ? '#ff8a80' : '#c62828',
  };

  return (
    <ScrollView
      style={[styles.root, {backgroundColor: colors.background}]}
      contentContainerStyle={styles.content}>
      <Text style={[styles.title, {color: colors.text}]}>救援模式</Text>
      <Text style={[styles.subtitle, {color: colors.subtext}]}>
        本构建仅用于导出数据库。请导出备份后，卸载本应用并安装正式版本，再导入备份恢复数据。
      </Text>
      <View style={[styles.card, {backgroundColor: colors.card}]}>
        {status === 'loading' && (
          <View style={styles.row}>
            <ActivityIndicator />
            <Text style={[styles.statusText, {color: colors.subtext}]}>
              正在打开数据库…
            </Text>
          </View>
        )}
        {status === 'error' && (
          <>
            <Text style={[styles.statusText, {color: colors.danger}]}>
              {`数据库打开失败：${error ?? '未知错误'}`}
            </Text>
            <Pressable
              style={styles.button}
              onPress={retry}
              android_ripple={{color: 'rgba(255,255,255,0.2)'}}>
              <Text style={[styles.buttonText, {color: colors.buttonText}]}>
                重试
              </Text>
            </Pressable>
          </>
        )}
        {status === 'ready' && (
          <>
            <Text style={[styles.statusText, {color: colors.text}]}>
              {phase === 'saved'
                ? phaseMessage
                : '点击下方按钮，选择保存位置完成导出。备份不含服务商配置（API 密钥），恢复后需重新填写。'}
            </Text>
            {phase === 'failed' && (
              <Text style={[styles.statusText, styles.gapTop, {color: colors.danger}]}>
                {`导出失败：${phaseMessage}`}
              </Text>
            )}
            <Pressable
              style={[styles.button, styles.gapTop, phase === 'exporting' && styles.buttonDisabled]}
              disabled={phase === 'exporting'}
              onPress={onExport}
              android_ripple={{color: 'rgba(255,255,255,0.2)'}}>
              {phase === 'exporting' ? (
                <ActivityIndicator color={colors.buttonText} />
              ) : (
                <Text style={[styles.buttonText, {color: colors.buttonText}]}>
                  导出数据库备份
                </Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {padding: 20, paddingTop: 60},
  title: {fontSize: 26, fontWeight: '700'},
  subtitle: {fontSize: 14, lineHeight: 21, marginTop: 8},
  card: {
    borderRadius: 14,
    padding: 18,
    marginTop: 20,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 10},
  statusText: {fontSize: 14, lineHeight: 21},
  button: {
    backgroundColor: '#3b6ef5',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonDisabled: {opacity: 0.6},
  buttonText: {fontSize: 15, fontWeight: '600'},
  gapTop: {marginTop: 14},
});
