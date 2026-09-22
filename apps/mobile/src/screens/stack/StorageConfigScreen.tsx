/**
 * 存储配置：存储空间概览、云端配置入口、数据清理与数据库导入导出。
 * 云同步状态与拉取/推送操作已迁移至 CloudSyncStorageScreen。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, ScrollView, StyleSheet} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {ListSectionTitle} from '../../components/ui/ListSectionTitle';
import {ProfileMenuItem} from '../../components/profile/ProfileMenuItem';
import {ProfileStatusCard} from '../../components/profile/ProfileStatusCard';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  exportDatabaseBackup,
  importDatabaseBackup,
} from '../../services/db-backup.service';
import {
  getDatabaseMaintenanceStats,
  runDatabaseMaintenance,
} from '../../services/db-maintenance.service';
import {getCloudSyncStatusView} from '../../services/cloud-sync.service';
import {
  isMobileAgentActive,
  subscribeMobileAgentActivity,
} from '../../runtime/agent-activity';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function StorageConfigScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {retry} = useNovelMaster();
  const navigation = useNavigation<Nav>();
  const [dbBusy, setDbBusy] = useState(false);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [agentActive, setAgentActive] = useState(false);
  const [dbFileBytes, setDbFileBytes] = useState<number | null>(null);
  const [dbReclaimableBytes, setDbReclaimableBytes] = useState<number | null>(
    null,
  );

  const refreshCloudConfigured = useCallback(async () => {
    try {
      const status = await getCloudSyncStatusView(runtime);
      setCloudConfigured(status.configured);
    } catch {
      setCloudConfigured(false);
    }
  }, [runtime]);

  const refreshMaintenanceStats = useCallback(async () => {
    try {
      const stats = await getDatabaseMaintenanceStats(runtime);
      setDbFileBytes(stats.fileBytes);
      setDbReclaimableBytes(stats.reclaimableBytes);
    } catch {
      // 统计仅用于展示（Agent 运行中会被守卫拒绝），失败静默占位
      setDbFileBytes(null);
      setDbReclaimableBytes(null);
    }
  }, [runtime]);

  const formatStorageBytes = (bytes: number | null): string => {
    if (bytes == null) {
      return '—';
    }
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    if (mb >= 1) {
      return `${mb.toFixed(1)} MB`;
    }
    return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  };

  const maintenanceControlValue = (): string => {
    if (dbBusy) {
      return '处理中…';
    }
    if (agentActive) {
      return 'Agent 运行中';
    }
    return '清理数据库空间';
  };

  useEffect(() => {
    setAgentActive(isMobileAgentActive());
    return subscribeMobileAgentActivity(setAgentActive);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshCloudConfigured().catch(() => undefined);
      refreshMaintenanceStats().catch(() => undefined);
    }, [refreshCloudConfigured, refreshMaintenanceStats]),
  );

  return (
    <ScrollView
      style={[styles.scroll, {backgroundColor: tokens.background}]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <ListSectionTitle title="存储空间" tokens={tokens} />
      <ProfileStatusCard
        title="存储空间"
        hint="数据库文件体积与清理可回收的空间"
        metrics={[
          {label: '库体积', value: formatStorageBytes(dbFileBytes)},
          {label: '可回收', value: formatStorageBytes(dbReclaimableBytes)},
        ]}
        tokens={tokens}
      />
      <ListSectionTitle title="云端配置" tokens={tokens} />
      <ProfileMenuItem
        icon="☁️"
        label="云端配置"
        value={cloudConfigured ? '已配置' : '未配置'}
        tokens={tokens}
        onPress={() => navigation.navigate('CloudSyncStorage')}
      />
      <ListSectionTitle title="数据清理" tokens={tokens} />
      <ProfileMenuItem
        icon="🧹"
        label="数据清理"
        value={maintenanceControlValue()}
        tokens={tokens}
        onPress={() => {
          if (dbBusy) {
            return;
          }
          Alert.alert(
            '数据清理',
            '将回收缓存冗余并压缩数据库文件，耗时随库体积增长（可能数十秒），期间请勿关闭应用，清理过程可能临时占用额外磁盘空间。是否继续？',
            [
              {text: '取消', style: 'cancel'},
              {
                text: '开始清理',
                onPress: () => {
                  setDbBusy(true);
                  runDatabaseMaintenance(runtime)
                    .then(({beforeBytes, afterBytes}) => {
                      showToast(
                        `清理完成：${formatStorageBytes(
                          beforeBytes,
                        )} → ${formatStorageBytes(afterBytes)}`,
                      );
                      refreshMaintenanceStats().catch(() => undefined);
                    })
                    .catch(err => showToast(toastMessage('清理失败', err)))
                    .finally(() => setDbBusy(false));
                },
              },
            ],
          );
        }}
      />
      <ListSectionTitle title="导入导出" tokens={tokens} />
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
          exportDatabaseBackup(runtime)
            .then(result => {
              if (result === 'saved') {
                showToast('数据库已导出；备份文件包含聊天记录明文，请妥善保管');
              }
            })
            .catch(err => showToast(toastMessage('导出失败', err)))
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
          Alert.alert(
            '导入数据库',
            '将用所选备份完全替换当前应用数据（项目、会话、消息等）。本机服务商与 API Key 将保留，备份中的服务商配置不会导入。此操作不可撤销，是否继续？',
            [
              {text: '取消', style: 'cancel'},
              {
                text: '继续选择文件',
                onPress: () => {
                  setDbBusy(true);
                  importDatabaseBackup(retry)
                    .then(() => showToast('正在重新加载，请稍候…'))
                    .catch(err => showToast(toastMessage('导入失败', err)))
                    .finally(() => setDbBusy(false));
                },
              },
            ],
          );
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 24},
});
