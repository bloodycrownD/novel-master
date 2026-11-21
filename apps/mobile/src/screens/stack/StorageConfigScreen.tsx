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
import {coreT} from '../../i18n/core';
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
const CLEANUP_CONFIRM_TEXT = coreT({key: "ui.storage.cleanup_confirm"});
// prettier-ignore
const IMPORT_CONFIRM_TEXT = coreT({key: "ui.storage.import_confirm_mobile"});

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
        title={coreT({key: "ui.storage.space_section"})}
        hint={coreT({key: "ui.storage.space_desc"})}
        metrics={[
          {label: coreT({key: "ui.storage.db_size"}), value: formatStorageBytes(dbFileBytes)},
          {label: coreT({key: "ui.storage.reclaimable"}), value: formatStorageBytes(dbReclaimBytes)},
        ]}
        tokens={tokens}
      />
      <ProfileMenuItem icon="☁️" label={coreT({key: "ui.storage.cloud_entry"})} value={cloudConfigured ? coreT({key: "ui.cloud_sync.configured"}) : coreT({key: "ui.cloud_sync.not_configured"})} tokens={tokens} onPress={() => navigation.navigate('CloudSyncStorage')} />
      <ProfileMenuItem
        icon="🧹"
        label={coreT({key: "ui.storage.cleanup_section"})}
        value={dbBusy ? coreT({key: "ui.common.processing"}) : agentActive ? coreT({key: "ui.cloud_sync.agent_busy_value"}) : coreT({key: "ui.storage.cleanup_action"})}
        tokens={tokens}
        onPress={() => {
          if (dbBusy) {
            return;
          }
          Alert.alert(coreT({key: "ui.storage.cleanup_section"}), CLEANUP_CONFIRM_TEXT, [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
              text: coreT({key: "ui.storage.cleanup_start"}),
              onPress: () => {
                setDbBusy(true);
                DbMaintenanceService.run(runtime)
                  .then(result => {
                    if (!result.ok) {
                      showToast(ToastMessage.toast(coreT({key: "ui.common.cleanup_failed"}), result.error));
                      return;
                    }
                    const before = formatStorageBytes(result.value.beforeBytes);
                    const after = formatStorageBytes(result.value.afterBytes);
                    showToast(coreT({key: "ui.storage.cleanup_done", params: {before, after}}));
                    refreshMaintenanceStats().catch(() => undefined);
                  })
                  .catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.cleanup_failed"}), err)))
                  .finally(() => setDbBusy(false));
              },
            },
          ]);
        }}
      />
      <ProfileMenuItem
        icon="💾"
        label={coreT({key: "ui.storage.export_db"})}
        value={dbBusy ? coreT({key: "ui.common.processing"}) : coreT({key: "ui.storage.share_backup"})}
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
                showToast(coreT({key: "ui.storage.export_db_done"}));
              }
            })
            .catch(err => {
              // 取消是控制流不是失败：不弹错误 toast（与桌面 IPC_ABORTED 同口径）。
              if (RequestAbort.isAbortLikeError(err)) {
                return;
              }
              showToast(ToastMessage.toast(coreT({key: "ui.common.export_failed"}), err));
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
        label={coreT({key: "ui.storage.export_logs"})}
        value={dbBusy ? coreT({key: "ui.common.processing"}) : coreT({key: "ui.storage.share_logs"})}
        tokens={tokens}
        onPress={() => {
          if (dbBusy) {
            return;
          }
          setDbBusy(true);
          LogExport.export()
            .then(result => {
              if (result === 'saved') {
                showToast(coreT({key: "ui.storage.logs_exported"}));
              }
            })
            .catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.export_failed"}), err)))
            .finally(() => setDbBusy(false));
        }}
      />
      <ProfileMenuItem
        icon="📥"
        label={coreT({key: "ui.storage.import_db"})}
        value={dbBusy ? coreT({key: "ui.common.processing"}) : coreT({key: "ui.storage.replace_all"})}
        tokens={tokens}
        onPress={() => {
          if (dbBusy) {
            return;
          }
          Alert.alert(coreT({key: "ui.storage.import_db"}), IMPORT_CONFIRM_TEXT, [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
              text: coreT({key: "ui.storage.continue_pick"}),
              onPress: () => {
                setDbBusy(true);
                setBackupBusy('import');
                setBackupCancelling(false);
                DbBackupService.importViaPicker(runtime, retry)
                  .then(result => {
                    if (result.ok) {
                      showToast(coreT({key: "ui.storage.reloading"}));
                    } else {
                      showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), result.error));
                    }
                  })
                  .catch(err => {
                    // 取消是控制流不是失败：不弹错误 toast（与桌面 IPC_ABORTED 同口径）。
                    if (RequestAbort.isAbortLikeError(err)) {
                      return;
                    }
                    showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), err));
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
          value={backupBusy === 'export' ? coreT({key: "ui.storage.export_db"}) : coreT({key: "ui.storage.import_db"})}
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
