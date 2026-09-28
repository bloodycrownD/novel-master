/**
 * 存储配置：存储空间概览、云端配置入口、数据清理与数据库导入导出。
 * 云同步状态与拉取/推送操作已迁移至 CloudSyncStorageScreen。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, ScrollView, StyleSheet} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
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
} from '../../services/db-maintenance.service';
import {getCloudSyncLocalStatus} from '../../services/cloud-sync-config.store';
import {
  isMobileAgentActive,
  subscribeMobileAgentActivity,
} from '../../runtime/agent-activity';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * 存量 blob 行形态归一（去 base64）状态行的展示文案。
 *
 * 表标识由 core 归一任务的注册表决定，且各波次注册进度不同（本波次只注册
 * 了 vfsContent / fileCache，messageContent 待消息压缩那条线合并后才进
 * 注册表），故 key 用宽 string 而非 core 的表标识联合：未注册的表照样出
 * 一行，value 落 '—' 占位。新增表时在此补一行映射即可。
 */
const BLOB_BINARY_LABELS: Record<string, string> = {
  vfsContent: '版本内容去 base64',
  fileCache: '文件缓存去 base64',
  messageContent: '消息正文去 base64',
};

/** 每个注册表一行；顺序与 core 归一任务的注册表一致。 */
const BLOB_BINARY_ROWS: ReadonlyArray<{table: string; label: string}> =
  Object.keys(BLOB_BINARY_LABELS).map(table => ({
    table,
    label: BLOB_BINARY_LABELS[table],
  }));

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
  const [messageCompaction, setMessageCompaction] = useState<{
    done: boolean;
    pendingCount: number;
  } | null>(null);

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
   * 归一状态文案两态：已完成 / 进行中（剩余 N 条）；未取到状态（如 Agent
   * 运行中采样被守卫拒绝、该表尚未注册适配器）显示占位 '—'。
   */
  const blobBinaryValue = (table: string): string => {
    const status = blobBinary.find(row => row.table === table);
    if (!status) {
      return '—';
    }
    return status.done ? '已完成' : `进行中（剩余 ${status.pendingCount} 条）`;
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
      <ProfileStatusCard
        title="存储空间"
        hint="数据库文件体积与清理可回收的空间"
        metrics={[
          {label: '库体积', value: formatStorageBytes(dbFileBytes)},
          {label: '可回收', value: formatStorageBytes(dbReclaimableBytes)},
        ]}
        tokens={tokens}
      />
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
      {BLOB_BINARY_ROWS.map(({table, label}) => (
        <ProfileMenuItem
          key={table}
          icon="🧬"
          label={label}
          value={blobBinaryValue(table)}
          tokens={tokens}
          onPress={() => {
            // 归一是后台自动任务，无需手动触发；点按只解释当前进度。
            const value = blobBinaryValue(table);
            Alert.alert(
              label,
              value === '—'
                ? '尚未采样到该表的归一状态（任务可能尚未开始，或该表当前版本未纳入归一）。应用空闲时会自动在后台完成，无需手动操作。'
                : value === '已完成'
                ? '该表的存量内容已全部转为二进制形态，库体积已相应减小。'
                : '后台正在把该表的存量内容从 base64 文本转为二进制，剩余条目见右侧。应用空闲时自动继续，期间 Agent 运行时会自动让路，无需手动操作。',
              [{text: '知道了', style: 'cancel'}],
            );
          }}
        />
      ))}
      <ProfileMenuItem
        icon="🗜️"
        label="消息压缩"
        value={
          messageCompaction == null
            ? '—'
            : messageCompaction.done
              ? '已完成'
              : `进行中（剩余 ${messageCompaction.pendingCount} 条）`
        }
        tokens={tokens}
        onPress={() => {
          // 两态状态行：只读展示（点击刷新状态），副文案在详情提示里给足。
          Alert.alert(
            '消息压缩',
            messageCompaction?.done
              ? '消息正文以 zlib 压缩存储，存储已优化完成。'
              : '消息正文正在后台压缩为 zlib 存储（迁移期间随时可正常使用）；完成前升级新版本，会在首次启动时等待优化收尾（一次性）。',
          );
          refreshMaintenanceStats().catch(() => undefined);
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
});
