/**
 * Full-screen file editor: read VFS, save via sessionFs (session) or vfs.write.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useRoute, type RouteProp} from '@react-navigation/native';
import type {RootStackParamList} from '../../navigation/types';
import {useRuntime} from '../../hooks/useRuntime';
import {useUnsavedGuard} from '../../hooks/useUnsavedGuard';
import {toastMessage} from '../../errors/toast-message';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {FileMarkdownPreview} from '../../components/vfs/FileMarkdownPreview';
import {formatCharCount} from '../../hooks/useAgentStreamMetrics';

type FileEditorRoute = RouteProp<RootStackParamList, 'FileEditor'>;

/** Last-saved timestamp for the stats row (device local time). */
function formatFileMtime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function FileEditorScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const route = useRoute<FileEditorRoute>();
  const {path, scopeKind, projectId, sessionId} = route.params;

  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [version, setVersion] = useState<number | undefined>();
  const [mtimeMs, setMtimeMs] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);

  const isDirty = content !== savedContent;
  useUnsavedGuard(isDirty);

  const resolveVfs = useCallback(() => {
    switch (scopeKind) {
      case 'global':
        return runtime.globalVfs();
      case 'project':
        if (!projectId) {
          throw new Error('缺少 projectId');
        }
        return runtime.projectVfs(projectId);
      case 'session':
        if (!projectId || !sessionId) {
          throw new Error('缺少 projectId 或 sessionId');
        }
        return runtime.sessionVfs(projectId, sessionId);
    }
  }, [runtime, scopeKind, projectId, sessionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const vfs = resolveVfs();
        const result = await vfs.read(path);
        if (cancelled) {
          return;
        }
        setContent(result.content);
        setSavedContent(result.content);
        setVersion(result.version);
        setMtimeMs(result.mtimeMs);
      } catch (error) {
        if (!cancelled) {
          showToast(toastMessage('读取失败', error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, resolveVfs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (scopeKind === 'session') {
        if (!projectId || !sessionId) {
          throw new Error('缺少 projectId 或 sessionId');
        }
        await runtime.sessionFs.execute(
          sessionId,
          projectId,
          [{function: 'write', path, content}],
          'user',
          version != null ? {expectedVersion: version} : {versionCheck: false},
        );
      } else {
        const vfs = resolveVfs();
        if (version == null) {
          await vfs.write(path, content, {versionCheck: false});
        } else {
          await vfs.write(path, content, {
            expectedVersion: version,
            versionCheck: true,
          });
        }
      }
      setSavedContent(content);
      const vfs = resolveVfs();
      const refreshed = await vfs.read(path);
      setVersion(refreshed.version);
      setMtimeMs(refreshed.mtimeMs);
      showToast('已保存');
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
    }
  };

  const togglePreview = () => {
    if (!previewMode) {
      Keyboard.dismiss();
    }
    setPreviewMode(prev => !prev);
  };

  if (loading) {
    return (
      <View style={[styles.center, {backgroundColor: tokens.background}]}>
        <ActivityIndicator color={tokens.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <View style={[styles.toolbar, {borderBottomColor: tokens.border}]}>
        <Pressable
          onPress={() => handleSave().catch(() => undefined)}
          disabled={saving || !isDirty || previewMode}>
          <Text
            style={{
              color:
                isDirty && !saving && !previewMode
                  ? tokens.primary
                  : tokens.textSecondary,
            }}>
            {saving ? '保存中…' : '保存'}
          </Text>
        </Pressable>
        <Text style={{color: isDirty ? tokens.danger : tokens.textSecondary}}>
          {isDirty ? '未保存' : path}
        </Text>
        <Pressable onPress={togglePreview}>
          <Text style={{color: previewMode ? tokens.primary : tokens.textSecondary}}>
            {previewMode ? '编辑' : '预览'}
          </Text>
        </Pressable>
      </View>
      {mtimeMs != null ? (
        <View style={[styles.statsRow, {borderBottomColor: tokens.border}]}>
          <Text
            style={[styles.statsText, {color: tokens.textSecondary}]}
            numberOfLines={1}>
            更新于 {formatFileMtime(mtimeMs)} · {formatCharCount(content.length)} 字
            {isDirty ? ' · 编辑中未保存' : ''}
          </Text>
        </View>
      ) : null}
      {previewMode ? (
        <ScrollView
          style={[styles.preview, {backgroundColor: tokens.surface}]}
          contentContainerStyle={styles.previewContent}
          keyboardShouldPersistTaps="handled">
          <FileMarkdownPreview path={path} content={content} tokens={tokens} />
        </ScrollView>
      ) : (
        <TextInput
          style={[
            styles.editor,
            {color: tokens.text, backgroundColor: tokens.surface},
          ]}
          multiline
          value={content}
          onChangeText={setContent}
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="top"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statsRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statsText: {fontSize: 12},
  editor: {
    flex: 1,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  preview: {flex: 1},
  previewContent: {padding: 12},
});
