/**
 * 云同步 Push/Pull 专用进度页：进入后执行同步，完成后自动返回。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, BackHandler, StyleSheet, View} from 'react-native';
import {type RouteProp, useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RequestAbort} from '@novel-master/core/llm-protocol';
import {ABORT_KEY} from '@novel-master/core/abort';
import {CloudSyncProgressPanel} from '@/components/chrome/CloudSyncProgressPanel';
import {SecondaryButton} from '@/components/ui/Buttons';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';
import {settingsTranslator} from '@/i18n/settings';
import {useStackOverrideSetter} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';
import {useRuntime} from '@/hooks/useRuntime';
import {useNovelMaster} from '@/runtime/novel-master-context';
import {CloudSyncService, type CloudSyncProgressUiState} from '@/services/cloud-sync.service';
import {CloudSyncProgressUi} from '@/services/cloud-sync-progress-ui';
import {AppErrorOps} from '@novel-master/core/errors';
import {useTheme} from '@/theme/ThemeProvider';

type Route = RouteProp<RootStackParamList, 'CloudSyncProgress'>;
type Nav = NativeStackNavigationProp<RootStackParamList, 'CloudSyncProgress'>;

export function CloudSyncProgressScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {retryAndWait} = useNovelMaster();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  // 屏级 override：自动带 ownerRouteKey，转场期间不泄漏到相邻屏 header。
  const setStackOverride = useStackOverrideSetter();

  const {op, forceOverwriteRemote = false} = route.params;
  const title = op === 'pull' ? coreT({key: "ui.cloud_sync.pull_title"}) : coreT({key: "ui.cloud_sync.push_title"});

  const [progress, setProgress] = useState<CloudSyncProgressUiState>(() => CloudSyncProgressUi.initial(op));
  const [running, setRunning] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const runningRef = useRef(true);
  const cancelled = progress.event === `${op}_cancelled`;

  // 任务级取消（signal-abort-scope Step 14）：key 与 service 注册的
  // `ABORT_KEY.cloudSync('local')` 同源；阶段级取消在下一个真实边界生效，
  // 点击后先收起按钮避免重复派发，进度终态由 service 的 onProgress 推送。
  const handleCancel = useCallback(() => {
    if (!running || cancelling) {
      return;
    }
    setCancelling(true);
    runtime.abortRegistry.abort(ABORT_KEY.cloudSync('local'));
  }, [running, cancelling, runtime]);

  const handleNeedPullFirst = useCallback(() => {
    Alert.alert(coreT({key: "ui.cloud_sync.cloud_newer_title"}), coreT({key: "ui.cloud_sync.cloud_newer_msg"}), [
      {
        text: coreT({key: "ui.common.cancel"}),
        style: 'cancel',
        onPress: () => navigation.goBack(),
      },
      {
        text: coreT({key: "ui.cloud_sync.pull_first"}),
        onPress: () => {
          navigation.replace('CloudSyncProgress', {op: 'pull'});
        },
      },
      {
        text: coreT({key: "ui.cloud_sync.force_overwrite"}),
        style: 'destructive',
        onPress: () => {
          navigation.replace('CloudSyncProgress', {
            op: 'push',
            forceOverwriteRemote: true,
          });
        },
      },
    ]);
  }, [navigation]);

  const onTitleFocus = useCallback(() => {
    // 取消终态下放开返回键：本页取消后不再自动 goBack（让用户看到终态），
    // 运行中仍隐藏返回键避免中途误退。
    setStackOverride({title, showBack: cancelled});
    return () => setStackOverride(undefined);
  }, [setStackOverride, title, cancelled]);
  useFocusEffect(onTitleFocus);

  const onBackFocus = useCallback(() => {
    const onBack = () => {
      if (runningRef.current) {
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => subscription.remove();
  }, []);
  useFocusEffect(onBackFocus);

  useEffect(() => {
    let active = true;
    runningRef.current = true;
    setRunning(true);
    setCancelling(false);
    setProgress(CloudSyncProgressUi.initial(op));

    const run = async (): Promise<void> => {
      // 已知失败沿 Result.err 回来（错误通道迁移四期），与剩余异常共用同一
      // 套失败收尾（NEED_PULL_FIRST 控制流 + toast），不再解包 throw。
      const handleFailure = (error: unknown): void => {
        if (!active) {
          return;
        }
        if (RequestAbort.isAbortLikeError(error)) {
          // 取消是控制流信号，不是失败：进度走取消终态、按钮消失、不弹错误
          // 提示。service 已通过 onProgress 推过 *_cancelled；这里再兜一次，
          // 覆盖取消早于首帧进度回调的窗口。留在本页看终态，不自动返回。
          runningRef.current = false;
          setRunning(false);
          setCancelling(false);
          setProgress(CloudSyncProgressUi.mapEvent(op, `${op}_cancelled`) ?? CloudSyncProgressUi.initial(op));
          return;
        }
        if (op === 'push' && AppErrorOps.is(error, 'CLOUD_SYNC_NEED_PULL_FIRST') && !forceOverwriteRemote) {
          runningRef.current = false;
          handleNeedPullFirst();
          return;
        }
        showToast(ToastMessage.toast(op === 'pull' ? coreT({key: "ui.common.pull_failed"}) : coreT({key: "ui.common.push_failed"}), error));
        runningRef.current = false;
        navigation.goBack();
      };
      try {
        if (op === 'pull') {
          // retryAndWait：拉取换库后必须用**重建出来的新 runtime** 记账，
          // 旧 runtime 背后的连接已被换库关掉。retry（只 setBootToken）
          // 拿不到新 runtime。
          const pullOptions = {
            onProgress: (state: CloudSyncProgressUiState) => {
              if (active) {
                setProgress(state);
              }
            },
          };
          const result = await CloudSyncService.pull(runtime, retryAndWait, pullOptions);
          if (!result.ok) {
            handleFailure(result.error);
            return;
          }
          if (!active) {
            return;
          }
          if (result.value.alreadyUpToDate) {
            showToast(coreT({key: "ui.cloud_sync.up_to_date"}));
          } else {
            showToast(coreT({key: "ui.cloud_sync.pull_reloading"}));
          }
        } else {
          const pushOptions = {
            forceOverwriteRemote,
            onProgress: (state: CloudSyncProgressUiState) => {
              if (active) {
                setProgress(state);
              }
            },
          };
          const pushed = await CloudSyncService.push(runtime, pushOptions);
          if (!pushed.ok) {
            handleFailure(pushed.error);
            return;
          }
          if (!active) {
            return;
          }
          showToast('推送成功');
        }
        runningRef.current = false;
        navigation.goBack();
      } catch (error) {
        handleFailure(error);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [op, forceOverwriteRemote, runtime, retryAndWait, navigation, showToast, handleNeedPullFirst]);

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <CloudSyncProgressPanel title={title} state={progress} tokens={tokens} />
      {running && !cancelling ? (
        <View style={styles.cancelRow}>
          <SecondaryButton tokens={tokens} label={settingsTranslator({key: 'settings.long_task.cancel'})} onPress={handleCancel} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  cancelRow: {alignItems: 'center', paddingBottom: 40},
});
