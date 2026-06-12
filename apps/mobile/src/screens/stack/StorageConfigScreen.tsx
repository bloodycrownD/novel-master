/**
 * 存储配置：云同步状态/操作与数据库导入导出。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, ScrollView, StyleSheet} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {ListSectionTitle} from '../../components/ui/ListSectionTitle';
import {ProfileMenuItem} from '../../components/ui/ProfileMenuItem';
import {ProfileStatusCard} from '../../components/ui/ProfileStatusCard';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  exportDatabaseBackup,
  importDatabaseBackup,
} from '../../services/db-backup.service';
import {
  getCloudSyncStatusView,
  pullCloudSync,
  pushCloudSync,
} from '../../services/cloud-sync.service';
import {isCloudSyncError} from '@novel-master/core';
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
  const [syncBusy, setSyncBusy] = useState(false);
  const [cloudRemoteRev, setCloudRemoteRev] = useState<number | null>(null);
  const [cloudLastSyncedRev, setCloudLastSyncedRev] = useState<number | null>(
    null,
  );
  const [cloudSuggestPull, setCloudSuggestPull] = useState(false);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [cloudLastPullAt, setCloudLastPullAt] = useState<string | undefined>();
  const [cloudLastPushAt, setCloudLastPushAt] = useState<string | undefined>();
  const [cloudLastPullResult, setCloudLastPullResult] = useState<
    string | undefined
  >();
  const [cloudLastPushResult, setCloudLastPushResult] = useState<
    string | undefined
  >();
  const [agentActive, setAgentActive] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);

  const refreshCloudSyncStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await getCloudSyncStatusView(runtime);
      setCloudConfigured(status.configured);
      setCloudRemoteRev(status.remoteRev);
      setCloudLastSyncedRev(status.lastSyncedRev);
      setCloudSuggestPull(status.suggestPull);
      setCloudLastPullAt(status.lastPullAt);
      setCloudLastPushAt(status.lastPushAt);
      setCloudLastPullResult(status.lastPullResult);
      setCloudLastPushResult(status.lastPushResult);
    } catch {
      setCloudConfigured(false);
      setCloudRemoteRev(null);
      setCloudLastSyncedRev(null);
      setCloudSuggestPull(false);
      setCloudLastPullAt(undefined);
      setCloudLastPushAt(undefined);
      setCloudLastPullResult(undefined);
      setCloudLastPushResult(undefined);
    } finally {
      setStatusLoading(false);
    }
  }, [runtime]);

  const formatSyncTime = (iso?: string): string => {
    if (!iso) {
      return '—';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleString();
  };

  const syncControlsDisabled = dbBusy || syncBusy || agentActive;

  const formatSyncResultLabel = (result?: string): string | undefined => {
    if (result === 'success') {
      return '成功';
    }
    if (result === 'already_up_to_date') {
      return '已是最新';
    }
    if (result === 'error') {
      return '失败';
    }
    return result?.trim() ? result : undefined;
  };

  const syncControlValue = (
    lastAt?: string,
    lastResult?: string,
  ): string => {
    if (agentActive) {
      return 'Agent 运行中';
    }
    if (syncBusy) {
      return '处理中…';
    }
    if (lastAt) {
      const resultLabel = formatSyncResultLabel(lastResult);
      const time = formatSyncTime(lastAt);
      return resultLabel != null ? `${resultLabel} · ${time}` : `上次 ${time}`;
    }
    return '手动同步';
  };

  const syncStatusContent = (): {
    message?: string;
    metrics?: Array<{label: string; value: string; tone?: 'default' | 'warning' | 'success'}>;
  } => {
    if (statusLoading) {
      return {message: '加载中…'};
    }
    if (!cloudConfigured) {
      return {message: '请先完成云存储配置'};
    }
    if (cloudRemoteRev == null || cloudLastSyncedRev == null) {
      return {message: '无法读取同步状态'};
    }
    const aligned = cloudRemoteRev === cloudLastSyncedRev;
    return {
      metrics: [
        {label: '云端 rev', value: String(cloudRemoteRev)},
        {
          label: '本机 rev',
          value: String(cloudLastSyncedRev),
          tone: aligned ? 'success' : 'warning',
        },
      ],
    };
  };

  const syncStatusNotice = (): string | undefined => {
    if (statusLoading || !cloudConfigured) {
      return undefined;
    }
    if (agentActive) {
      return 'Agent 运行中，同步操作已禁用。';
    }
    if (cloudSuggestPull) {
      return '云端有更新，建议先拉取后再推送。';
    }
    if (
      cloudRemoteRev != null &&
      cloudLastSyncedRev != null &&
      cloudRemoteRev === cloudLastSyncedRev
    ) {
      return '本机与云端 rev 已对齐。';
    }
    return undefined;
  };

  const runPull = useCallback(() => {
    if (syncControlsDisabled) {
      return;
    }
    Alert.alert(
      '从云端拉取',
      '将用云端最新快照替换本机数据（项目、会话、消息等）。本机服务商与 API Key 将保留。是否继续？',
      [
        {text: '取消', style: 'cancel'},
        {
          text: '拉取',
          onPress: () => {
            setSyncBusy(true);
            pullCloudSync(runtime, retry)
              .then(result => {
                if (result.alreadyUpToDate) {
                  showToast('已是最新');
                } else {
                  showToast('拉取成功，正在重新加载…');
                }
              })
              .catch(err => showToast(toastMessage('拉取失败', err)))
              .finally(() => {
                setSyncBusy(false);
                refreshCloudSyncStatus().catch(() => undefined);
              });
          },
        },
      ],
    );
  }, [syncControlsDisabled, runtime, retry, showToast, refreshCloudSyncStatus]);

  const runPush = useCallback(
    (forceOverwriteRemote = false) => {
      if (syncControlsDisabled) {
        return;
      }
      setSyncBusy(true);
      pushCloudSync(runtime, {forceOverwriteRemote})
        .then(() => showToast('推送成功'))
        .catch(err => {
          if (
            isCloudSyncError(err) &&
            err.code === 'NEED_PULL_FIRST' &&
            !forceOverwriteRemote
          ) {
            Alert.alert(
              '云端有更新',
              '建议先拉取云端数据。仍要覆盖云端吗？',
              [
                {text: '取消', style: 'cancel'},
                {
                  text: '先拉取',
                  onPress: () => runPull(),
                },
                {
                  text: '仍要覆盖云端',
                  style: 'destructive',
                  onPress: () => runPush(true),
                },
              ],
            );
            return;
          }
          showToast(toastMessage('推送失败', err));
        })
        .finally(() => {
          setSyncBusy(false);
          refreshCloudSyncStatus().catch(() => undefined);
        });
    },
    [
      syncControlsDisabled,
      runtime,
      showToast,
      runPull,
      refreshCloudSyncStatus,
    ],
  );

  useEffect(() => {
    setAgentActive(isMobileAgentActive());
    return subscribeMobileAgentActivity(setAgentActive);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshCloudSyncStatus().catch(() => undefined);
    }, [refreshCloudSyncStatus]),
  );

  const syncStatus = syncStatusContent();

  return (
    <ScrollView
      style={[styles.scroll, {backgroundColor: tokens.background}]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled">
      <ListSectionTitle title="云同步" tokens={tokens} />
      <ProfileStatusCard
        title="同步状态"
        hint="显示本机与云端的 rev 对齐情况"
        message={syncStatus.message}
        metrics={syncStatus.metrics}
        notice={syncStatusNotice()}
        noticeTone={
          agentActive || cloudSuggestPull ? 'warning' : 'muted'
        }
        tokens={tokens}
      />
      <ProfileMenuItem
        icon="☁️"
        label="云存储配置"
        value={cloudConfigured ? '已配置' : '未配置'}
        tokens={tokens}
        onPress={() => navigation.navigate('CloudSyncConfig')}
      />
      <ProfileMenuItem
        icon="⬇️"
        label="从云端拉取"
        value={syncControlValue(cloudLastPullAt, cloudLastPullResult)}
        tokens={tokens}
        onPress={runPull}
      />
      <ProfileMenuItem
        icon="⬆️"
        label="推送到云端"
        value={syncControlValue(cloudLastPushAt, cloudLastPushResult)}
        tokens={tokens}
        onPress={() => runPush()}
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
                showToast('数据库已导出');
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
