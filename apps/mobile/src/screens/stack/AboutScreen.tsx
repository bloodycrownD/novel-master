/**
 * About Novel Master: version, update check, and project links.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, Linking, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useToast} from '../../components/chrome/ToastHost';
import {ListSectionTitle} from '../../components/ui/ListSectionTitle';
import {ProfileMenuItem} from '../../components/ui/ProfileMenuItem';
import {ProfileSwitchItem} from '../../components/ui/ProfileSwitchItem';
import {toastMessage} from '../../errors/toast-message';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  persistFailedUpdateCheck,
  persistUpdateCheckResult,
  readLastCheckRemoteVersion,
  readLastCheckStatus,
  readUpdatesAutoCheck,
  writeDismissedVersion,
  writeUpdatesAutoCheck,
} from '../../storage/update-prefs';
import {APP_LINKS, APP_VERSION} from '../../update-check/app-meta';
import {checkForUpdates} from '../../update-check/check-for-updates';
import type {UpdateCheckData} from '../../update-check/types';
import {useTheme} from '../../theme/ThemeProvider';

function formatStatusLabel(
  status: string | undefined,
  remote: string | undefined,
): string {
  if (status === 'up-to-date') return '当前已是最新版本';
  if (status === 'available' && remote) return `有新版本 ${remote}`;
  if (status === 'error') return '上次检查失败';
  return '—';
}

function showUpdateAlert(
  data: UpdateCheckData,
  onLater: () => void,
): void {
  const message = data.releaseNotesExcerpt
    ? `v${data.remoteVersion}\n\n${data.releaseNotesExcerpt}\n\n将在浏览器中打开 GitHub 发行页下载。`
    : `v${data.remoteVersion}\n\n将在浏览器中打开 GitHub 发行页下载。`;

  Alert.alert('发现新版本', message, [
    {text: '取消', style: 'cancel'},
    {text: '稍后', onPress: onLater},
    {
      text: '前往下载',
      onPress: () => {
        void Linking.openURL(data.releaseUrl);
      },
    },
  ]);
}

export function AboutScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const {appUi} = useNovelMaster();
  const [autoCheck, setAutoCheck] = useState(true);
  const [lastStatus, setLastStatus] = useState<string | undefined>();
  const [lastRemote, setLastRemote] = useState<string | undefined>();
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    if (!appUi) return;
    const [auto, status, remote] = await Promise.all([
      readUpdatesAutoCheck(appUi),
      readLastCheckStatus(appUi),
      readLastCheckRemoteVersion(appUi),
    ]);
    setAutoCheck(auto);
    setLastStatus(status);
    setLastRemote(remote);
  }, [appUi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runManualCheck = useCallback(async () => {
    if (!appUi) return;
    setChecking(true);
    try {
      const data = await checkForUpdates();
      await persistUpdateCheckResult(appUi, data);
      setLastStatus(
        data.status === 'update-available' ? 'available' : 'up-to-date',
      );
      setLastRemote(data.remoteVersion);
      if (data.status === 'up-to-date') {
        showToast('当前已是最新版本');
        return;
      }
      showUpdateAlert(data, () => {
        void writeDismissedVersion(appUi, data.remoteVersion);
      });
    } catch (err) {
      await persistFailedUpdateCheck(appUi);
      setLastStatus('error');
      showToast(toastMessage('检查失败', err));
    } finally {
      setChecking(false);
    }
  }, [appUi, showToast]);

  const openLink = useCallback(
    (url: string) => {
      void Linking.openURL(url).catch(err =>
        showToast(toastMessage('无法打开链接', err)),
      );
    },
    [showToast],
  );

  return (
    <ScrollView
      style={[styles.scroll, {backgroundColor: tokens.background}]}
      contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <View
          style={[
            styles.logoBox,
            {backgroundColor: tokens.surfaceElevated, borderColor: tokens.borderLight},
          ]}>
          <Text style={styles.logoEmoji} accessibilityLabel="Novel Master">
            📖
          </Text>
        </View>
        <Text style={[styles.title, {color: tokens.text}]}>Novel Master</Text>
        <Text style={[styles.version, {color: tokens.textSecondary}]}>
          版本 {APP_VERSION}
        </Text>
      </View>

      <ListSectionTitle title="更新" tokens={tokens} />
      <ProfileSwitchItem
        icon="🔄"
        label="自动检查更新"
        value={autoCheck}
        tokens={tokens}
        onValueChange={next => {
          if (!appUi) return;
          setAutoCheck(next);
          void writeUpdatesAutoCheck(appUi, next).catch(err =>
            showToast(toastMessage('保存失败', err)),
          );
        }}
      />
      <ProfileMenuItem
        icon="⬇️"
        label="检查更新"
        value={checking ? '检查中…' : formatStatusLabel(lastStatus, lastRemote)}
        tokens={tokens}
        onPress={() => {
          if (!checking) void runManualCheck();
        }}
      />

      <ListSectionTitle title="项目链接" tokens={tokens} />
      <ProfileMenuItem
        icon="🔗"
        label="GitHub 仓库"
        tokens={tokens}
        onPress={() => openLink(APP_LINKS.repo)}
      />
      <ProfileMenuItem
        icon="📦"
        label="发行版"
        tokens={tokens}
        onPress={() => openLink(APP_LINKS.releases)}
      />
      <ProfileMenuItem
        icon="📄"
        label="许可证"
        tokens={tokens}
        onPress={() => openLink(APP_LINKS.license)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 24},
  header: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 8,
    gap: 8,
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoEmoji: {
    fontSize: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  version: {
    fontSize: 14,
  },
});
