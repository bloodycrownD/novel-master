/**
 * Profile tab: menu items navigate to stack screens.
 */
import React, {useCallback, useState} from 'react';
import {Alert, ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AgentPickerModal} from '../../components/agent/AgentPickerModal';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {RegexGroupPickerModal} from '../../components/regex/RegexGroupPickerModal';
import {AppHeader} from '../../components/chrome/AppHeader';
import {ListSectionTitle} from '../../components/ui/ListSectionTitle';
import {ProfileMenuItem} from '../../components/ui/ProfileMenuItem';
import {ProfileSwitchItem} from '../../components/ui/ProfileSwitchItem';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
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
import {isMobileAgentActive} from '../../runtime/agent-activity';
import {
  readChatRichTextEnabled,
  writeChatRichTextEnabled,
} from '../../storage/chat-rich-text-pref';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import {resolveCurrentAgentDisplayLabel} from '../../services/agent-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const WORKSPACE_MODEL_MENU = {
  icon: '🤖',
  label: '当前模型',
} as const;

const WORKSPACE_AGENT_MENU = {
  icon: '🧠',
  label: '当前 agent',
} as const;

const WORKSPACE_REGEX_GROUP_MENU = {
  icon: '🛡️',
  label: '当前正则组',
} as const;

const CONFIG_MENU: Array<{icon: string; label: string; route: keyof RootStackParamList}> =
  [
    {icon: '🤖', label: 'agent管理', route: 'AgentsSettings'},
    {icon: '🔌', label: '服务商管理', route: 'Providers'},
    {icon: '🗜️', label: '压缩条件', route: 'CompactionConditions'},
    {icon: '⚡', label: '事件配置', route: 'EventsConfig'},
    {icon: '🛡️', label: '正则配置', route: 'RegexGroups'},
    {icon: '🌐', label: '全局工作区', route: 'GlobalTemplate'},
  ];

export function ProfileTabScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {appUi, retry} = useNovelMaster();
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
  const [agentActive, setAgentActive] = useState(false);
  const [modelLabel, setModelLabel] = useState('—');
  const [agentLabel, setAgentLabel] = useState('—');
  const [regexGroupLabel, setRegexGroupLabel] = useState('不启用');
  const [llmStreamEnabled, setLlmStreamEnabled] = useState(true);
  const [sessionFsVersionCheck, setSessionFsVersionCheck] = useState(true);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [agentPickerVisible, setAgentPickerVisible] = useState(false);
  const [regexGroupPickerVisible, setRegexGroupPickerVisible] =
    useState(false);

  const dismissAllOverlays = useCallback(() => {
    setModelPickerVisible(false);
    setAgentPickerVisible(false);
    setRegexGroupPickerVisible(false);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const refreshAgentLabel = useCallback(async () => {
    try {
      setAgentLabel(await resolveCurrentAgentDisplayLabel(runtime));
    } catch {
      setAgentLabel('—');
    }
  }, [runtime]);

  const refreshModelLabel = useCallback(async () => {
    const currentId = await runtime.state.getCurrentModelId();
    if (!currentId) {
      setModelLabel('—');
      return;
    }
    try {
      setModelLabel(await resolveModelDisplayLabel(runtime, currentId));
    } catch {
      setModelLabel(currentId);
    }
  }, [runtime]);

  const refreshRegexGroupLabel = useCallback(async () => {
    const currentId = await runtime.state.getCurrentRegexGroupId();
    if (!currentId) {
      setRegexGroupLabel('不启用');
      return;
    }
    try {
      const group = await runtime.regexConfig.getGroup(currentId);
      setRegexGroupLabel(group.displayName?.trim() || group.groupId);
    } catch {
      setRegexGroupLabel('不启用');
    }
  }, [runtime]);

  const refreshStreamPref = useCallback(async () => {
    setLlmStreamEnabled(await runtime.preferences.getLlmStreamEnabled());
  }, [runtime]);

  const refreshSessionFsVersionCheckPref = useCallback(async () => {
    setSessionFsVersionCheck(
      await runtime.preferences.getSessionFsVersionCheck(),
    );
  }, [runtime]);

  const refreshChatRichTextPref = useCallback(async () => {
    if (appUi == null) {
      return;
    }
    setChatRichTextEnabled(await readChatRichTextEnabled(appUi));
  }, [appUi]);

  const refreshCloudSyncStatus = useCallback(async () => {
    try {
      const status = await getCloudSyncStatusView(runtime);
      setCloudConfigured(status.configured);
      setCloudRemoteRev(status.remoteRev);
      setCloudLastSyncedRev(status.lastSyncedRev);
      setCloudSuggestPull(status.suggestPull);
      setCloudLastPullAt(status.lastPullAt);
      setCloudLastPushAt(status.lastPushAt);
    } catch {
      setCloudConfigured(false);
      setCloudRemoteRev(null);
      setCloudLastSyncedRev(null);
      setCloudSuggestPull(false);
      setCloudLastPullAt(undefined);
      setCloudLastPushAt(undefined);
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

  const syncControlValue = (lastAt?: string): string => {
    if (agentActive) {
      return 'Agent 运行中';
    }
    if (syncBusy) {
      return '处理中…';
    }
    if (lastAt) {
      return `上次 ${formatSyncTime(lastAt)}`;
    }
    return '手动同步';
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
      retry,
      showToast,
      runPull,
      refreshCloudSyncStatus,
    ],
  );

  useFocusEffect(
    useCallback(() => {
      setAgentActive(isMobileAgentActive());
      refreshModelLabel().catch(() => setModelLabel('—'));
      refreshAgentLabel().catch(() => setAgentLabel('—'));
      refreshRegexGroupLabel().catch(() => setRegexGroupLabel('不启用'));
      refreshStreamPref().catch(() => undefined);
      refreshSessionFsVersionCheckPref().catch(() => undefined);
      refreshChatRichTextPref().catch(() => undefined);
      refreshCloudSyncStatus().catch(() => undefined);
    }, [
      refreshModelLabel,
      refreshAgentLabel,
      refreshRegexGroupLabel,
      refreshStreamPref,
      refreshSessionFsVersionCheckPref,
      refreshChatRichTextPref,
      refreshCloudSyncStatus,
    ]),
  );

  const navigateTo = (route: keyof RootStackParamList) => {
    const parent = navigation.getParent();
    if (parent) {
      parent.navigate(route);
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="profile" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <ListSectionTitle title="工作区" tokens={tokens} />
        <ProfileMenuItem
          icon={WORKSPACE_MODEL_MENU.icon}
          label={WORKSPACE_MODEL_MENU.label}
          value={modelLabel}
          tokens={tokens}
          onPress={() => setModelPickerVisible(true)}
        />
        <ProfileMenuItem
          icon={WORKSPACE_AGENT_MENU.icon}
          label={WORKSPACE_AGENT_MENU.label}
          value={agentLabel}
          tokens={tokens}
          onPress={() => setAgentPickerVisible(true)}
        />
        <ProfileMenuItem
          icon={WORKSPACE_REGEX_GROUP_MENU.icon}
          label={WORKSPACE_REGEX_GROUP_MENU.label}
          value={regexGroupLabel}
          tokens={tokens}
          onPress={() => setRegexGroupPickerVisible(true)}
        />
        <ProfileSwitchItem
          icon="⚡"
          label="流式输出"
          subtitle={
            llmStreamEnabled
              ? '边生成边显示（推荐）'
              : '完成后一次性显示回复'
          }
          value={llmStreamEnabled}
          tokens={tokens}
          onValueChange={enabled => {
            setLlmStreamEnabled(enabled);
            runtime.preferences
              .setLlmStreamEnabled(enabled)
              .catch(() => undefined);
          }}
        />
        <ProfileSwitchItem
          icon="🛡️"
          label="Session FS 版本校验"
          subtitle={
            sessionFsVersionCheck
              ? '写入时校验 VFS 版本号（推荐）'
              : '写入时跳过版本冲突检查'
          }
          value={sessionFsVersionCheck}
          tokens={tokens}
          onValueChange={enabled => {
            setSessionFsVersionCheck(enabled);
            runtime.preferences
              .setSessionFsVersionCheck(enabled)
              .catch(() => undefined);
          }}
        />
        <ProfileSwitchItem
          icon="📝"
          label="富文本消息"
          subtitle={
            chatRichTextEnabled
              ? '用户与助手消息解析 Markdown/HTML'
              : '聊天消息显示为纯文本'
          }
          value={chatRichTextEnabled}
          tokens={tokens}
          onValueChange={enabled => {
            setChatRichTextEnabled(enabled);
            if (appUi) {
              writeChatRichTextEnabled(appUi, enabled).catch(() => undefined);
            }
          }}
        />
        <ListSectionTitle title="数据管理" tokens={tokens} />
        <ListSectionTitle title="云同步" tokens={tokens} />
        <ProfileMenuItem
          icon="☁️"
          label="云存储配置"
          value={cloudConfigured ? '已配置' : '未配置'}
          tokens={tokens}
          onPress={() => navigateTo('CloudSyncConfig')}
        />
        <ProfileMenuItem
          icon="📊"
          label="同步状态"
          value={
            cloudRemoteRev != null && cloudLastSyncedRev != null
              ? `云端 rev ${cloudRemoteRev} · 本机 ${cloudLastSyncedRev}${
                  cloudSuggestPull ? ' · 建议先拉取' : ''
                }`
              : '—'
          }
          tokens={tokens}
          onPress={() => refreshCloudSyncStatus().catch(() => undefined)}
        />
        <ProfileMenuItem
          icon="⬇️"
          label="从云端拉取"
          value={syncControlValue(cloudLastPullAt)}
          tokens={tokens}
          onPress={runPull}
        />
        <ProfileMenuItem
          icon="⬆️"
          label="推送到云端"
          value={syncControlValue(cloudLastPushAt)}
          tokens={tokens}
          onPress={() => runPush()}
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
                      .catch(err =>
                        showToast(toastMessage('导入失败', err)),
                      )
                      .finally(() => setDbBusy(false));
                  },
                },
              ],
            );
          }}
        />
        <ListSectionTitle title="配置" tokens={tokens} />
        {CONFIG_MENU.map(item => (
          <ProfileMenuItem
            key={item.route}
            icon={item.icon}
            label={item.label}
            tokens={tokens}
            onPress={() => navigateTo(item.route)}
          />
        ))}
        <ListSectionTitle title="应用" tokens={tokens} />
        <ProfileMenuItem
          icon="ℹ️"
          label="关于 Novel Master"
          tokens={tokens}
          onPress={() => navigateTo('About')}
        />
      </ScrollView>
      <ModelPickerModal
        visible={modelPickerVisible}
        onClose={() => setModelPickerVisible(false)}
        onSelected={() => refreshModelLabel().catch(() => undefined)}
      />
      <AgentPickerModal
        visible={agentPickerVisible}
        onClose={() => setAgentPickerVisible(false)}
        onSelected={() => refreshAgentLabel().catch(() => undefined)}
      />
      <RegexGroupPickerModal
        visible={regexGroupPickerVisible}
        onClose={() => setRegexGroupPickerVisible(false)}
        onSelected={() => refreshRegexGroupLabel().catch(() => undefined)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 24},
});
