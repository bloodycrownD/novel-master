/**
 * 云端存储设置：同步状态展示、云存储配置入口与云端拉取/推送操作。
 * 由 StorageConfigScreen 原「云同步」区整体迁移而来，状态与交互逻辑随迁。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, ScrollView, StyleSheet} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {ProfileMenuItem} from '../../components/profile/ProfileMenuItem';
import {ProfileStatusCard} from '../../components/profile/ProfileStatusCard';
import {useRuntime} from '../../hooks/useRuntime';
import {coreT} from '../../i18n/core';
import {CloudSyncService} from '../../services/cloud-sync.service';
import {agentActivity} from '../../runtime/agent-activity';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function CloudSyncStorageScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [cloudRemoteRev, setCloudRemoteRev] = useState<number | null>(null);
  const [cloudLastSyncedRev, setCloudLastSyncedRev] = useState<number | null>(null);
  const [cloudSuggestPull, setCloudSuggestPull] = useState(false);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [cloudLastPullAt, setCloudLastPullAt] = useState<string | undefined>();
  const [cloudLastPushAt, setCloudLastPushAt] = useState<string | undefined>();
  const [cloudLastPullResult, setCloudLastPullResult] = useState<string | undefined>();
  const [cloudLastPushResult, setCloudLastPushResult] = useState<string | undefined>();
  const [agentActive, setAgentActive] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);

  const refreshCloudSyncStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await CloudSyncService.getStatusView(runtime);
      const view = status.ok ? status.value : {configured: false, deviceId: '', lastSyncedRev: 0, remoteRev: 0, suggestPull: false};
      setCloudConfigured(view.configured);
      setCloudRemoteRev(view.remoteRev);
      setCloudLastSyncedRev(view.lastSyncedRev);
      setCloudSuggestPull(view.suggestPull);
      setCloudLastPullAt(view.lastPullAt);
      setCloudLastPushAt(view.lastPushAt);
      setCloudLastPullResult(view.lastPullResult);
      setCloudLastPushResult(view.lastPushResult);
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

  const syncControlsDisabled = agentActive;

  const formatSyncResultLabel = (result?: string): string | undefined => {
    if (result === 'success') {
      return coreT({key: "ui.cloud_sync.result_ok"});
    }
    if (result === 'already_up_to_date') {
      return coreT({key: "ui.cloud_sync.up_to_date"});
    }
    if (result === 'error') {
      return coreT({key: "ui.cloud_sync.result_fail"});
    }
    return result?.trim() ? result : undefined;
  };

  const syncControlValue = (lastAt?: string, lastResult?: string): string => {
    if (agentActive) {
      return coreT({key: "ui.cloud_sync.agent_busy_value"});
    }
    if (lastAt) {
      const resultLabel = formatSyncResultLabel(lastResult);
      const time = formatSyncTime(lastAt);
      return resultLabel != null ? `${resultLabel} · ${time}` : coreT({key: "ui.cloud_sync.last_time", params: {time}});
    }
    return coreT({key: "ui.cloud_sync.manual_sync"});
  };

  const syncStatusContent = (): {
    message?: string;
    metrics?: Array<{
      label: string;
      value: string;
      tone?: 'default' | 'warning' | 'success';
    }>;
  } => {
    if (statusLoading) {
      return {message: coreT({key: "ui.common.loading"})};
    }
    if (!cloudConfigured) {
      return {message: coreT({key: "ui.cloud_sync.not_configured_msg"})};
    }
    if (cloudRemoteRev == null || cloudLastSyncedRev == null) {
      return {message: coreT({key: "ui.cloud_sync.status_unreadable"})};
    }
    const aligned = cloudRemoteRev === cloudLastSyncedRev;
    return {
      metrics: [
        {label: coreT({key: "ui.cloud_sync.rev_cloud"}), value: String(cloudRemoteRev)},
        {
          label: coreT({key: "ui.cloud_sync.rev_local"}),
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
      return coreT({key: "ui.cloud_sync.agent_active_note"});
    }
    if (cloudSuggestPull) {
      return coreT({key: "ui.cloud_sync.cloud_newer_hint"});
    }
    if (cloudRemoteRev != null && cloudLastSyncedRev != null && cloudRemoteRev === cloudLastSyncedRev) {
      return coreT({key: "ui.cloud_sync.local_status"});
    }
    return undefined;
  };

  const runPull = useCallback(() => {
    if (syncControlsDisabled) {
      return;
    }
    Alert.alert(coreT({key: "ui.cloud_sync.pull_title"}), coreT({key: "ui.cloud_sync.pull_confirm_msg"}), [
      {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
      {
        text: coreT({key: "ui.cloud_sync.pull_action"}),
        onPress: () => navigation.navigate('CloudSyncProgress', {op: 'pull'}),
      },
    ]);
  }, [syncControlsDisabled, navigation]);

  const runPush = useCallback(() => {
    if (syncControlsDisabled) {
      return;
    }
    navigation.navigate('CloudSyncProgress', {op: 'push'});
  }, [syncControlsDisabled, navigation]);

  useEffect(() => {
    setAgentActive(agentActivity.isActive());
    return agentActivity.subscribe(setAgentActive);
  }, []);

  const onScreenFocus = useCallback(() => {
    refreshCloudSyncStatus().catch(() => undefined);
  }, [refreshCloudSyncStatus]);
  useFocusEffect(onScreenFocus);

  const syncStatus = syncStatusContent();

  return (
    <ScrollView style={[styles.scroll, {backgroundColor: tokens.background}]} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <ProfileStatusCard
        title={coreT({key: "ui.cloud_sync.sync_status"})}
        hint={coreT({key: "ui.cloud_sync.status_desc"})}
        message={syncStatus.message}
        metrics={syncStatus.metrics}
        notice={syncStatusNotice()}
        noticeTone={agentActive || cloudSuggestPull ? 'warning' : 'muted'}
        tokens={tokens}
      />
      <ProfileMenuItem icon="☁️" label={coreT({key: "ui.nav.cloud_storage"})} value={cloudConfigured ? coreT({key: "ui.cloud_sync.configured"}) : coreT({key: "ui.cloud_sync.not_configured"})} tokens={tokens} onPress={() => navigation.navigate('CloudSyncConfig')} />
      <ProfileMenuItem icon="⬇️" label={coreT({key: "ui.cloud_sync.pull_title"})} value={syncControlValue(cloudLastPullAt, cloudLastPullResult)} tokens={tokens} onPress={runPull} />
      <ProfileMenuItem icon="⬆️" label={coreT({key: "ui.cloud_sync.push_title"})} value={syncControlValue(cloudLastPushAt, cloudLastPushResult)} tokens={tokens} onPress={runPush} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 24},
});
