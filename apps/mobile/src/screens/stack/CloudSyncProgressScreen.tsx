/**
 * 云同步 Push/Pull 专用进度页：进入后执行同步，完成后自动返回。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, BackHandler, StyleSheet, View} from 'react-native';
import {
  type RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {CloudSyncProgressPanel} from '../../components/chrome/CloudSyncProgressPanel';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  initialCloudSyncProgressUi,
  pullCloudSync,
  pushCloudSync,
  type CloudSyncProgressUiState,
} from '../../services/cloud-sync.service';
import {isCloudSyncError} from '@novel-master/core';
import {useTheme} from '../../theme/ThemeProvider';

type Route = RouteProp<RootStackParamList, 'CloudSyncProgress'>;
type Nav = NativeStackNavigationProp<RootStackParamList, 'CloudSyncProgress'>;

export function CloudSyncProgressScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {retry} = useNovelMaster();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const {setStackOverride} = useHeaderContext();

  const {op, forceOverwriteRemote = false} = route.params;
  const title = op === 'pull' ? '从云端拉取' : '推送到云端';

  const [progress, setProgress] = useState<CloudSyncProgressUiState>(() =>
    initialCloudSyncProgressUi(op),
  );
  const runningRef = useRef(true);

  const handleNeedPullFirst = useCallback(() => {
    Alert.alert('云端有更新', '建议先拉取云端数据。仍要覆盖云端吗？', [
      {
        text: '取消',
        style: 'cancel',
        onPress: () => navigation.goBack(),
      },
      {
        text: '先拉取',
        onPress: () => {
          navigation.replace('CloudSyncProgress', {op: 'pull'});
        },
      },
      {
        text: '仍要覆盖云端',
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

  useFocusEffect(
    useCallback(() => {
      setStackOverride({title, showBack: false});
      return () => setStackOverride(undefined);
    }, [setStackOverride, title]),
  );

  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (runningRef.current) {
          return true;
        }
        return false;
      };
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        onBack,
      );
      return () => subscription.remove();
    }, []),
  );

  useEffect(() => {
    let active = true;
    runningRef.current = true;
    setProgress(initialCloudSyncProgressUi(op));

    const run = async (): Promise<void> => {
      try {
        if (op === 'pull') {
          const result = await pullCloudSync(runtime, retry, {
            onProgress: state => {
              if (active) {
                setProgress(state);
              }
            },
          });
          if (!active) {
            return;
          }
          if (result.alreadyUpToDate) {
            showToast('已是最新');
          } else {
            showToast('拉取成功，正在重新加载…');
          }
        } else {
          await pushCloudSync(runtime, {
            forceOverwriteRemote,
            onProgress: state => {
              if (active) {
                setProgress(state);
              }
            },
          });
          if (!active) {
            return;
          }
          showToast('推送成功');
        }
        runningRef.current = false;
        navigation.goBack();
      } catch (error) {
        if (!active) {
          return;
        }
        if (
          op === 'push' &&
          isCloudSyncError(error) &&
          error.code === 'NEED_PULL_FIRST' &&
          !forceOverwriteRemote
        ) {
          runningRef.current = false;
          handleNeedPullFirst();
          return;
        }
        showToast(
          toastMessage(op === 'pull' ? '拉取失败' : '推送失败', error),
        );
        runningRef.current = false;
        navigation.goBack();
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [
    op,
    forceOverwriteRemote,
    runtime,
    retry,
    navigation,
    showToast,
    handleNeedPullFirst,
  ]);

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <CloudSyncProgressPanel title={title} state={progress} tokens={tokens} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
