/**
 * 存储配置：存储空间概览、存量数据迁移进度、云端配置入口、数据清理与
 * 数据库导入导出。云同步状态与拉取/推送操作已迁移至 CloudSyncStorageScreen。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {FormSectionCard} from '../../components/form/FormSectionCard';
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
  type BlobBinaryTableStatus,
  type MessageCompactionStatus,
} from '../../services/db-maintenance.service';
import {
  blobBinaryValue,
  messageCompactionValue,
  type MigrationValue,
} from './storage-config-migration-values';
import {getCloudSyncLocalStatus} from '../../services/cloud-sync-config.store';
import {
  isMobileAgentActive,
  subscribeMobileAgentActivity,
} from '../../runtime/agent-activity';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * 维护指标轮询间隔（ic-23，方案 A）：长耗时搬运期间页面聚焦时按此间隔
 * 重采样，进度不再停在进页快照。取区间上沿 5s——blobBinary 未完成态的
 * 谓词 COUNT 不可索引（每表一次全表扫），mobile 端从宽留 IO 余量；
 * 稳态只读 KKV 标记，零 COUNT 成本。
 */
const MAINTENANCE_STATS_POLL_INTERVAL_MS = 5_000;

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
  const [blobBinary, setBlobBinary] = useState<BlobBinaryTableStatus[]>([]);
  const [messageCompaction, setMessageCompaction] = useState<
    MessageCompactionStatus | null
  >(null);

  const refreshCloudConfigured = useCallback(async () => {
    try {
      // 仅取本地 configured 布尔值，走 kkv 本地读取，不触发 S3 网络往返；
      // 远端同步状态（rev/建议拉取等）由 CloudSyncStorageScreen 负责。
      const status = await getCloudSyncLocalStatus(runtime);
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
      setBlobBinary(stats.blobBinary);
      setMessageCompaction(stats.messageCompaction);
    } catch {
      // 统计仅用于展示（Agent 运行中会被守卫拒绝），失败静默占位
      setDbFileBytes(null);
      setDbReclaimableBytes(null);
      setBlobBinary([]);
      setMessageCompaction(null);
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

  /**
   * 迁移卡片三行（用户拍板 2026-09-28）：消息正文压缩 + 两张 blob 表去
   * base64，指标卡形态只读展示（非菜单项）。消息正文「去 base64」不设
   * 状态行——发版形态下压缩搬运直接写二进制，不存在用户可见的中间态，
   * 仅开发机历史形态由归一任务静默收敛。取值逻辑在
   * storage-config-migration-values（ic-22 抽出的纯函数，四组夹具直测）。
   */
  const migrationRows: ReadonlyArray<{label: string} & MigrationValue> = [
    {...messageCompactionValue(messageCompaction), label: '消息正文压缩'},
    {
      ...blobBinaryValue(blobBinary.find(row => row.table === 'vfsContent')),
      label: '版本内容去 base64',
    },
    {
      ...blobBinaryValue(blobBinary.find(row => row.table === 'fileCache')),
      label: '文件缓存去 base64',
    },
  ];

  const migrationValueColor = (tone: MigrationValue['tone']): string => {
    if (tone === 'success') {
      return tokens.success;
    }
    if (tone === 'warning') {
      return tokens.warning;
    }
    return tokens.text;
  };

  useEffect(() => {
    setAgentActive(isMobileAgentActive());
    return subscribeMobileAgentActivity(setAgentActive);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshCloudConfigured().catch(() => undefined);
      refreshMaintenanceStats().catch(() => undefined);
      // ic-23（方案 A）：聚焦期间轮询重采样，长耗时搬运的进度不停在
      // 进页快照；同一 cleanup 覆盖失焦与卸载，离开页面即停（不再空转
      // 采样）。与「后台自动整理、期间可正常使用」的文案预期对齐。
      const interval = setInterval(() => {
        refreshMaintenanceStats().catch(() => undefined);
      }, MAINTENANCE_STATS_POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [refreshCloudConfigured, refreshMaintenanceStats]),
  );

  return (
    <ScrollView
      style={[styles.scroll, {backgroundColor: tokens.background}]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <ProfileStatusCard
        title="存储空间"
        hint="数据库文件体积与清理可回收的空间"
        metrics={[
          {label: '库体积', value: formatStorageBytes(dbFileBytes)},
          {label: '可回收', value: formatStorageBytes(dbReclaimableBytes)},
        ]}
        tokens={tokens}
      />
      <FormSectionCard
        title="存量数据迁移"
        hint="后台自动整理存量数据（压缩与二进制化），期间可正常使用，Agent 运行时自动让路"
        tokens={tokens}>
        {migrationRows.map(row => (
          <View key={row.label} style={styles.migrationRow}>
            <Text
              style={[styles.migrationLabel, {color: tokens.textSecondary}]}
              numberOfLines={2}>
              {row.label}
            </Text>
            <Text
              style={[
                styles.migrationValue,
                {color: migrationValueColor(row.tone)},
              ]}>
              {row.value}
            </Text>
          </View>
        ))}
      </FormSectionCard>
      <ProfileMenuItem
        icon="☁️"
        label="云端配置"
        value={cloudConfigured ? '已配置' : '未配置'}
        tokens={tokens}
        onPress={() => navigation.navigate('CloudSyncStorage')}
      />
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
  migrationRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  migrationLabel: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  migrationValue: {
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
});
