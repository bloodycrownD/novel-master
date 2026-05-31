/**
 * Session log: merged tool + checkpoint timeline with FIFO banner and rollback.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, StyleSheet, Text, View} from 'react-native';
import {CheckpointFifoBanner} from '../../components/session-log/CheckpointFifoBanner';
import {SessionTimeline} from '../../components/session-log/SessionTimeline';
import {useMobileScope} from '../../hooks/useMobileScope';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  loadSessionLog,
  rollbackSessionBatch,
} from '../../services/session-log.service';
import {appUiKeys} from '../../storage/app-ui-prefs';
import {APP_UI_DEFAULTS} from '../../storage/app-ui-keys';
import type {TimelineItem} from '../../components/session-log/timeline-builder';
import {useTheme} from '../../theme/ThemeProvider';

function parseRetention(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? APP_UI_DEFAULTS.checkpointRetention, 10);
  if (!Number.isFinite(n)) {
    return 100;
  }
  return Math.min(500, Math.max(1, Math.round(n)));
}

export function SessionLogScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const {appUi} = useNovelMaster();
  const {projectId, sessionId} = useMobileScope();

  const [timeline, setTimeline] = useState<readonly TimelineItem[]>([]);
  const [retention, setRetention] = useState(100);
  const [loading, setLoading] = useState(true);
  const [rollbackInProgress, setRollbackInProgress] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const reload = useCallback(async () => {
    if (sessionId == null) {
      setTimeline([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let retentionRaw: string | undefined;
      if (appUi) {
        retentionRaw = await appUi.get(appUiKeys.checkpointRetention);
      }
      const retentionN = parseRetention(retentionRaw);
      setRetention(retentionN);
      const snap = await loadSessionLog(runtime, sessionId, {
        checkpointRetention: retentionN,
      });
      setTimeline(snap.timeline);
    } catch (error) {
      Alert.alert(
        '加载失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setLoading(false);
    }
  }, [runtime, sessionId, appUi]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const handleRollback = useCallback(
    (batchId: string) => {
      if (projectId == null || sessionId == null || rollbackInProgress) {
        return;
      }
      Alert.alert('回滚检查点', '确定回滚到此检查点？将撤销该批次之后的文件变更。', [
        {text: '取消', style: 'cancel'},
        {
          text: '回滚',
          style: 'destructive',
          onPress: () => {
            setRollbackInProgress(true);
            rollbackSessionBatch(runtime, sessionId, projectId, batchId)
              .then(() => reload())
              .catch(err =>
                Alert.alert(
                  '回滚失败',
                  err instanceof Error ? err.message : String(err),
                ),
              )
              .finally(() => setRollbackInProgress(false));
          },
        },
      ]);
    },
    [projectId, sessionId, rollbackInProgress, runtime, reload],
  );

  if (sessionId == null || projectId == null) {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <Text style={[styles.placeholder, {color: tokens.textSecondary}]}>
          请先选择项目与会话
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <CheckpointFifoBanner retention={retention} />
      {loading && timeline.length === 0 ? (
        <Text style={[styles.placeholder, {color: tokens.textSecondary}]}>
          加载中…
        </Text>
      ) : (
        <SessionTimeline
          items={timeline}
          nowMs={nowMs}
          rollbackInProgress={rollbackInProgress}
          onRollback={handleRollback}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  placeholder: {textAlign: 'center', marginTop: 48, padding: 16},
});
