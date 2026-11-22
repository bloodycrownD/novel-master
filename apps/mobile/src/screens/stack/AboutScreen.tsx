/**
 * About Novel Master: version, update check, and project links.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, Linking, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useToast} from '@/components/chrome/ToastHost';
import {ListSectionTitle} from '@/components/ui/ListSectionTitle';
import {ProfileMenuItem} from '@/components/profile/ProfileMenuItem';
import {ProfileSwitchItem} from '@/components/profile/ProfileSwitchItem';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';
import {useNovelMaster} from '@/runtime/novel-master-context';
import {UpdatePrefs} from '@/storage/update-prefs';
import {AppUiPrefIo} from '@/storage/app-ui-pref-io';
import {APP_UI_KEY_UPDATES_AUTO_CHECK} from '@/storage/app-ui-keys';
import {APP_LINKS, APP_VERSION} from '@/update-check/app-meta';
import {CheckForUpdates} from '@/update-check/check-for-updates';
import type {UpdateCheckData} from '@novel-master/core/common';
import {useTheme} from '@/theme/ThemeProvider';

function showUpdateAlert(data: UpdateCheckData, onLater: () => void): void {
    const openSuffix = coreT({key: "ui.update.open_releases_suffix"});
    let message: string;
    if (data.releaseNotesExcerpt) {
        message = `v${data.remoteVersion}\n\n${data.releaseNotesExcerpt}\n\n${openSuffix}`;
    } else {
        message = `v${data.remoteVersion}\n\n${openSuffix}`;
    }

    Alert.alert(coreT({key: "ui.update.available_title"}), message, [
        {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
        {text: coreT({key: "ui.update.later"}), onPress: onLater},
        {
            text: coreT({key: "ui.update.go_download"}),
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
        const [auto, status, remote] = await Promise.all([AppUiPrefIo.readBoolPref(appUi, APP_UI_KEY_UPDATES_AUTO_CHECK, true), UpdatePrefs.readLastCheckStatus(appUi), UpdatePrefs.readLastCheckRemoteVersion(appUi)]);
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
            const checked = await CheckForUpdates.check();
            // 已知失败（版本比较非法）沿 Result.err 收口，口径对齐下方 catch
            // （错误通道迁移六期）；网络等未知异常仍走 reject。
            if (!checked.ok) {
                await UpdatePrefs.persistFailedUpdateCheck(appUi);
                setLastStatus('error');
                showToast(ToastMessage.toast(coreT({key: "ui.common.check_failed"}), checked.error));
                return;
            }
            const data = checked.value;
            await UpdatePrefs.persistUpdateCheckResult(appUi, data);
            setLastStatus(data.status === 'update-available' ? 'available' : 'up-to-date');
            setLastRemote(data.remoteVersion);
            if (data.status === 'up-to-date') {
                showToast(coreT({key: "ui.update.up_to_date"}));
                return;
            }
            showUpdateAlert(data, () => {
                void UpdatePrefs.writeDismissedVersion(appUi, data.remoteVersion);
            });
        } catch (err) {
            await UpdatePrefs.persistFailedUpdateCheck(appUi);
            setLastStatus('error');
            showToast(ToastMessage.toast(coreT({key: "ui.common.check_failed"}), err));
        } finally {
            setChecking(false);
        }
    }, [appUi, showToast]);

    const openLink = useCallback(
        (url: string) => {
            void Linking.openURL(url).catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.open_link_failed"}), err)));
        },
        [showToast],
    );

    let statusLabel = '—';
    if (checking) statusLabel = coreT({key: "ui.update.checking"});
    else if (lastStatus === 'up-to-date') statusLabel = coreT({key: "ui.update.up_to_date"});
    else if (lastStatus === 'available' && lastRemote) statusLabel = coreT({key: "ui.update.new_version_line", params: {version: lastRemote}});
    else if (lastStatus === 'error') statusLabel = coreT({key: "ui.update.last_check_failed"});

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
                <Text style={[styles.version, {color: tokens.textSecondary}]}>{coreT({key: "ui.about.version", params: {version: APP_VERSION}})}</Text>
            </View>

            <ListSectionTitle title={coreT({key: "ui.update.section"})} tokens={tokens} />
            <ProfileSwitchItem
                icon="🔄"
                label={coreT({key: "ui.update.auto_check"})}
                value={autoCheck}
                tokens={tokens}
                onValueChange={next => {
                    if (!appUi) return;
                    setAutoCheck(next);
                    void AppUiPrefIo.writeBoolPref(appUi, APP_UI_KEY_UPDATES_AUTO_CHECK, next).catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), err)));
                }}
            />
            <ProfileMenuItem
                icon="⬇️"
                label={coreT({key: "ui.update.check_now"})}
                value={statusLabel}
                tokens={tokens}
                onPress={() => {
                    if (!checking) void runManualCheck();
                }}
            />

            <ListSectionTitle title={coreT({key: "ui.about.links_section"})} tokens={tokens} />
            <ProfileMenuItem icon="🔗" label={coreT({key: "ui.about.github_repo"})} tokens={tokens} onPress={() => openLink(APP_LINKS.repo)} />
            <ProfileMenuItem icon="📦" label={coreT({key: "ui.about.releases"})} tokens={tokens} onPress={() => openLink(APP_LINKS.releases)} />
            <ProfileMenuItem icon="📄" label={coreT({key: "ui.about.license"})} tokens={tokens} onPress={() => openLink(APP_LINKS.license)} />
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
