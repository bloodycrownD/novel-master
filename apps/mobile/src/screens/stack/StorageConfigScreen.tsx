/**
 * 存储配置：存储空间概览、云端配置入口、数据清理与数据库导入导出。
 * 云同步状态与拉取/推送操作已迁移至 CloudSyncStorageScreen。
 *
 * 「存量数据迁移」指标卡已随第七轮退役整卡移除（v1.5.41：存量 blob 形态
 * 归一与 VFS 历史版本打包两个后台搬运任务退役，状态行与取值模块一并删除）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, ScrollView, StyleSheet} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RequestAbort} from '@novel-master/core/llm-protocol';
import {ABORT_KEY} from '@novel-master/core/abort';
import {Number, STORAGE_BYTES} from '@novel-master/core/common';
import {ProfileMenuItem} from '../../components/profile/ProfileMenuItem';
import {ProfileStatusCard} from '../../components/profile/ProfileStatusCard';
import {useToast} from '../../components/chrome/ToastHost';
import {ToastMessage} from '../../errors/toast-message';
import {settingsTranslator} from '../../i18n/settings';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {DbBackupService} from '../../services/db-backup.service';
import {DbMaintenanceService} from '../../services/db-maintenance.service';
import {LogExport} from '../../services/log-export';
import {CloudSyncConfigStore} from '../../services/cloud-sync-config.store';
import {agentActivity} from '../../runtime/agent-activity';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type BackupTask = 'export' | 'import';

// prettier-ignore
const CLEANUP_CONFIRM_TEXT = '将回收缓存冗余并压缩数据库文件，耗时随库体积增长（可能数十秒），期间请勿关闭应用，清理过程可能临时占用额外磁盘空间。是否继续？';
// prettier-ignore
const IMPORT_CONFIRM_TEXT = '将用所选备份完全替换当前应用数据（项目、会话、消息等）。本机服务商与 API Key 将保留，备份中的服务商配置不会导入。此操作不可撤销，是否继续？';

export function StorageConfigScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {retry} = useNovelMaster();
  const navigation = useNavigation<Nav>();
  const [dbBusy, setDbBusy] = useState(false);
  // 可取消的长任务仅覆盖备份导出/导入（backup("local")）；数据清理的
  // VACUUM 区段不可中断，spec 明确不提供取消按钮，故不纳入此状态。
  const [backupBusy, setBackupBusy] = useState<BackupTask | null>(null);
  const [backupCancelling, setBackupCancelling] = useState(false);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [agentActive, setAgentActive] = useState(false);
  const [dbFileBytes, setDbFileBytes] = useState<number | null>(null);
  const [dbReclaimBytes, setDbReclaimBytes] = useState<number | null>(null);

  const refreshCloudConfigured = useCallback(async () => {
    // 仅取本地 configured 布尔值，走 kkv 本地读取，不触发 S3 网络往返；
    // 远端同步状态（rev/建议拉取等）由 CloudSyncStorageScreen 负责。
    // 读失败（错误通道迁移四期：Result）与旧 catch 同款按未配置呈现。
    const status = await CloudSyncConfigStore.getLocalStatus(runtime);
    setCloudConfigured(status.ok && status.value.configured);
  }, [runtime]);

  const refreshMaintenanceStats = useCallback(async () => {
    const stats = await DbMaintenanceService.getStats(runtime);
    // 统计仅用于展示（Agent 运行中会被守卫拒绝），失败静默占位；
    // 平台异常仍走 reject，由外层调用方的 .catch 收口。
    setDbFileBytes(stats.ok ? stats.value.fileBytes : null);
    setDbReclaimBytes(stats.ok ? stats.value.reclaimableBytes : null);
  }, [runtime]);

  // 备份导出/导入的任务级取消（Step 14）：service 注册的 key 固定
  // `backup("local")`；点击后先收起按钮，AbortError 由下方 catch 静默收尾。
  const handleCancelBackup = useCallback(() => {
    if (backupBusy == null || backupCancelling) {
      return;
    }
    setBackupCancelling(true);
    runtime.abortRegistry.abort(ABORT_KEY.backup('local'));
  }, [backupBusy, backupCancelling, runtime]);

  // `null → "—"` 是 UI 空值文案，留在调用侧；`Math.max(0, …)` 是历史口径
  // （旧实现的 KB 分支把负数夹到 0，库体积不会为负，纯防御）。
  const formatStorageBytes = (bytes: number | null): string => (bytes == null ? '—' : Number.formatBytes(Math.max(0, bytes), STORAGE_BYTES));

  useEffect(() => {
    setAgentActive(agentActivity.isActive());
    return agentActivity.subscribe(setAgentActive);
  }, []);

  const refreshStorageOnFocus = useCallback(() => {
    refreshCloudConfigured().catch(() => undefined);
    refreshMaintenanceStats().catch(() => undefined);
  }, [refreshCloudConfigured, refreshMaintenanceStats]);

  useFocusEffect(refreshStorageOnFocus);

  return (
    <ScrollView style={[styles.scroll, {backgroundColor: tokens.background}]} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <ProfileStatusCard
        title="存储空间"
        hint="数据库文件体积与清理可回收的空间"
        metrics={[
          {label: '库体积', value: formatStorageBytes(dbFileBytes)},
          {label: '可回收', value: formatStorageBytes(dbReclaimBytes)},
        ]}
        tokens={tokens}
      />
      <ProfileMenuItem icon="☁️" label="云端配置" value={cloudConfigured ? '已配置' : '未配置'} tokens={tokens} onPress={() => navigation.navigate('CloudSyncStorage')} />
      <ProfileMenuItem
        icon="🧹"
        label="数据清理"
        value={dbBusy ? '处理中…' : agentActive ? 'Agent 运行中' : '清理数据库空间'}
        tokens={tokens}
        onPress={() => {
          if (dbBusy) {
            return;
          }
          Alert.alert('数据清理', CLEANUP_CONFIRM_TEXT, [
            {text: '取消', style: 'cancel'},
            {
              text: '开始清理',
              onPress: () => {
                setDbBusy(true);
                DbMaintenanceService.run(runtime)
                  .then(result => {
                    if (!result.ok) {
                      showToast(ToastMessage.toast('清理失败', result.error));
                      return;
                    }
                    const before = formatStorageBytes(result.value.beforeBytes);
                    const after = formatStorageBytes(result.value.afterBytes);
                    showToast(`清理完成：${before} → ${after}`);
                    refreshMaintenanceStats().catch(() => undefined);
                  })
                  .catch(err => showToast(ToastMessage.toast('清理失败', err)))
                  .finally(() => setDbBusy(false));
              },
            },
          ]);
        }}
      />
      <ProfileMenuItem
        icon="💾"
        label="导出数据库"
        value={dbBusy ? '处理中…' : '分享备份文件'}
        tokens={tokens}
        onPress={() => {
          if (dbBusy) {
            return;
          }
          setDbBusy(true);
          setBackupBusy('export');
          setBackupCancelling(false);
          DbBackupService.exportViaPicker(runtime)
            .then(result => {
              if (result.ok && result.value === 'saved') {
                showToast('数据库已导出；备份文件包含聊天记录明文，请妥善保管');
              }
            })
            .catch(err => {
              // 取消是控制流不是失败：不弹错误 toast（与桌面 IPC_ABORTED 同口径）。
              if (RequestAbort.isAbortLikeError(err)) {
                return;
              }
              showToast(ToastMessage.toast('导出失败', err));
            })
            .finally(() => {
              setBackupBusy(null);
              setBackupCancelling(false);
              setDbBusy(false);
            });
        }}
      />
      <ProfileMenuItem
        icon="📝"
        label="导出日志"
        value={dbBusy ? '处理中…' : '分享日志文件'}
        tokens={tokens}
        onPress={() => {
          if (dbBusy) {
            return;
          }
          setDbBusy(true);
          LogExport.export()
            .then(result => {
              if (result === 'saved') {
                showToast('日志已导出');
              }
            })
            .catch(err => showToast(ToastMessage.toast('导出失败', err)))
            .finally(() => setDbBusy(false));
        }}
      />
      <ProfileMenuItem
        icon="📥"
        label="导入数据库"
        value={dbBusy ? '处理中…' : '完全替换'}
        tokens={tokens}
        onPress={() => {
          if (dbBusy) {
            return;
          }
          Alert.alert('导入数据库', IMPORT_CONFIRM_TEXT, [
            {text: '取消', style: 'cancel'},
            {
              text: '继续选择文件',
              onPress: () => {
                setDbBusy(true);
                setBackupBusy('import');
                setBackupCancelling(false);
                DbBackupService.importViaPicker(runtime, retry)
                  .then(result => {
                    if (result.ok) {
                      showToast('正在重新加载，请稍候…');
                    } else {
                      showToast(ToastMessage.toast('导入失败', result.error));
                    }
                  })
                  .catch(err => {
                    // 取消是控制流不是失败：不弹错误 toast（与桌面 IPC_ABORTED 同口径）。
                    if (RequestAbort.isAbortLikeError(err)) {
                      return;
                    }
                    showToast(ToastMessage.toast('导入失败', err));
                  })
                  .finally(() => {
                    setBackupBusy(null);
                    setBackupCancelling(false);
                    setDbBusy(false);
                  });
              },
            },
          ]);
        }}
      />
      {backupBusy != null && !backupCancelling ? (
        <ProfileMenuItem
          icon="✖️"
          label={settingsTranslator({key: 'settings.long_task.cancel'})}
          value={backupBusy === 'export' ? '导出数据库' : '导入数据库'}
          tokens={tokens}
          onPress={handleCancelBackup}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 24},
});
