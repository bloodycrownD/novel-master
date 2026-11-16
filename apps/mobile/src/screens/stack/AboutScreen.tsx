/**
 * About Novel Master: version, update check, and project links.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, Linking, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useToast} from '@/components/chrome/ToastHost';
import {ListSectionTitle} from '@/components/ui/ListSectionTitle';
import {ProfileMenuItem} from '@/components/profile/ProfileMenuItem';
import {ProfileSwitchItem} from '@/components/profile/ProfileSwitchItem';
import {toastMessage} from '@/errors/toast-message';
import {useNovelMaster} from '@/runtime/novel-master-context';
import {
  persistFailedUpdateCheck,
  persistUpdateCheckResult,
  readLastCheckRemoteVersion,
  readLastCheckStatus,
  readUpdatesAutoCheck,
  writeDismissedVersion,
  writeUpdatesAutoCheck,
} from '@/storage/update-prefs';
import {APP_LINKS, APP_VERSION} from '@/update-check/app-meta';
import {checkForUpdates} from '@/update-check/check-for-updates';
import type {UpdateCheckData} from '@/update-check/types';
import {useTheme} from '@/theme/ThemeProvider';

function showUpdateAlert(data: UpdateCheckData, onLater: () => void): void {
  let message: string;
  if (data.releaseNotesExcerpt) {
    message = `v${data.remoteVersion}\n\n${data.releaseNotesExcerpt}\n\n将在浏览器中打开 GitHub 发行页下载。`;
  } else {
    message = `v${data.remoteVersion}\n\n将在浏览器中打开 GitHub 发行页下载。`;
  }

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
    // 读偏好失败按「无记录」呈现（错误通道迁移四期：reader 走 Result），
    // 与旧异常通道 `void refresh()` 丢弃 rejection 的可见结果一致。
    const [auto, status, remote] = await Promise.all([readUpdatesAutoCheck(appUi), readLastCheckStatus(appUi), readLastCheckRemoteVersion(appUi)]);
    setAutoCheck(auto);
    setLastStatus(status.ok ? status.value : undefined);
    setLastRemote(remote.ok ? remote.value : undefined);
  }, [appUi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runManualCheck = useCallback(async () => {
    if (!appUi) return;
    setChecking(true);
    try {
      const checked = await checkForUpdates();
      // 已知失败（版本比较非法）沿 Result.err 收口，口径对齐下方 catch
      // （错误通道迁移六期）；网络等未知异常仍走 reject。
      if (!checked.ok) {
        await persistFailedUpdateCheck(appUi);
        setLastStatus('error');
        showToast(toastMessage('检查失败', checked.error));
        return;
      }
      const data = checked.value;
      await persistUpdateCheckResult(appUi, data);
      setLastStatus(data.status === 'update-available' ? 'available' : 'up-to-date');
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
      void Linking.openURL(url).catch(err => showToast(toastMessage('无法打开链接', err)));
    },
    [showToast],
  );

  let statusLabel = '—';
  if (checking) statusLabel = '检查中…';
  else if (lastStatus === 'up-to-date') statusLabel = '当前已是最新版本';
  else if (lastStatus === 'available' && lastRemote) statusLabel = `有新版本 ${lastRemote}`;
  else if (lastStatus === 'error') statusLabel = '上次检查失败';

  return (
    <ScrollView style={[styles.scroll, {backgroundColor: tokens.background}]} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <View
          style={[
            styles.logoBox,
            {
              backgroundColor: tokens.surfaceElevated,
              borderColor: tokens.borderLight,
            },
          ]}
        >
          <Text style={styles.logoEmoji} accessibilityLabel="Novel Master">
            📖
          </Text>
        </View>
        <Text style={[styles.title, {color: tokens.text}]}>Novel Master</Text>
        <Text style={[styles.version, {color: tokens.textSecondary}]}>版本 {APP_VERSION}</Text>
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
          void writeUpdatesAutoCheck(appUi, next).catch(err => showToast(toastMessage('保存失败', err)));
        }}
      />
      <ProfileMenuItem
        icon="⬇️"
        label="检查更新"
        value={statusLabel}
        tokens={tokens}
        onPress={() => {
          if (!checking) void runManualCheck();
        }}
      />

      <ListSectionTitle title="项目链接" tokens={tokens} />
      <ProfileMenuItem icon="🔗" label="GitHub 仓库" tokens={tokens} onPress={() => openLink(APP_LINKS.repo)} />
      <ProfileMenuItem icon="📦" label="发行版" tokens={tokens} onPress={() => openLink(APP_LINKS.releases)} />
      <ProfileMenuItem icon="📄" label="许可证" tokens={tokens} onPress={() => openLink(APP_LINKS.license)} />
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
