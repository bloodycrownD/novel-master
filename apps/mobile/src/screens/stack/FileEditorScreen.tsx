/**
 * Full-screen file editor: read VFS, save via scoped vfs.write (no checkpoint).
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useRoute, type RouteProp} from '@react-navigation/native';
import type {RootStackParamList} from '../../navigation/types';
import type {VfsService} from '@novel-master/core/vfs';
import {useRuntime} from '../../hooks/useRuntime';
import {useUnsavedGuard} from '../../hooks/useUnsavedGuard';
import {toastMessage} from '../../errors/toast-message';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {sessionSaveVfsFile} from '../../services/vfs-operations.service';
import {isUserVfsUnifiedToolTurnEnabled} from '@novel-master/core/feature-flags';
import {
  FileMarkdownPreview,
  isMarkdownPreviewPath,
} from '../../components/vfs/FileMarkdownPreview';
import {shouldEnableFileAnnotate} from '../../components/vfs/file-annotate-gate';
import {
  CodeEditorWebView,
  type CodeEditorWebViewHandle,
} from '../../components/vfs/CodeEditorWebView';
import {EditorScreenShell} from '../../components/chrome/EditorScreenShell';
import {formatCharCount} from '@novel-master/core/format';

type FileEditorRoute = RouteProp<RootStackParamList, 'FileEditor'>;

/** VFS logical path → file name segment for toolbar (full path stays in route params). */
function vfsBasename(logicalPath: string): string {
  const trimmed = logicalPath.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

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
  const {path, scopeKind, projectId, sessionId, skillRef, onSessionVfsSaved} =
    route.params;

  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [version, setVersion] = useState<number | undefined>();
  const [mtimeMs, setMtimeMs] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);
  const [editorFocused, setEditorFocused] = useState(false);
  const [previewRenderKind, setPreviewRenderKind] = useState<
    'markdown' | 'txt'
  >('markdown');
  const codeEditorRef = useRef<CodeEditorWebViewHandle>(null);

  const isDirty = content !== savedContent;
  useUnsavedGuard(isDirty);

  // physical = 全局文件浏览器只读分支：保存入口禁用，也不提供编辑切换。
  const isReadOnly = scopeKind === 'physical';

  // 冷启动优化：物理树文件普遍较大（整章正文等），推屏转场期间同步挂
  // WebView 会卡住转场动画。只读分支延迟到交互空闲后再挂重预览；
  // 其余分支（会话工作区等既有路径）行为不变。
  const [heavyPreviewReady, setHeavyPreviewReady] = useState(!isReadOnly);
  useEffect(() => {
    if (heavyPreviewReady) {
      return;
    }
    // 短延时让推屏转场先启动，之后才挂 WebView（冷启动大文件不再卡转场）。
    const timer = setTimeout(() => setHeavyPreviewReady(true), 80);
    return () => clearTimeout(timer);
  }, [heavyPreviewReady]);

  const resolveVfs = useCallback(() => {
    switch (scopeKind) {
      case 'physical':
        // 全局文件浏览器：跨域拼接的只读物理树（无任何写方法）。
        return runtime.physicalVfs();
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
      case 'skill':
        // 技能已重定位到独立 meta 域，路由 path 仍锚定 /meta/skills/{name}/ 前缀
        if (!skillRef) {
          throw new Error('缺少 skillRef');
        }
        if (skillRef.domain === 'global') {
          return runtime.globalMetaVfs();
        }
        if (!skillRef.projectId) {
          throw new Error('项目域技能缺少 projectId');
        }
        return runtime.projectMetaVfs(skillRef.projectId);
    }
  }, [runtime, scopeKind, projectId, sessionId, skillRef]);

  // 保存路径专用：physical 分支类型层面无写方法且保存已禁用，
  // 其余分支均为单 scope 可写 VFS，收窄仅为满足写接口签名。
  const resolveWritableVfs = useCallback(
    () => resolveVfs() as VfsService,
    [resolveVfs],
  );

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
  }, [path, resolveVfs, showToast]);

  // Reset preview tab default when opening a different file.
  useEffect(() => {
    setPreviewRenderKind(isMarkdownPreviewPath(path) ? 'markdown' : 'txt');
  }, [path]);

  // 技能辅助文件在详情页被删除时踢回，避免停留在已不存在的文件上
  const handleSave = async () => {
    if (isReadOnly) {
      return;
    }
    setSaving(true);
    try {
      const vfs = resolveWritableVfs();
      if (
        scopeKind === 'session' &&
        sessionId &&
        isUserVfsUnifiedToolTurnEnabled()
      ) {
        await sessionSaveVfsFile(
          runtime,
          sessionId,
          vfs,
          path,
          content,
          {
            expectedVersion: version,
            versionCheck: version != null,
          },
          savedContent,
        );
        setSavedContent(content);
        const refreshed = await vfs.read(path);
        setVersion(refreshed.version);
        setMtimeMs(refreshed.mtimeMs);
        onSessionVfsSaved?.();
        showToast('已保存');
        return;
      }

      if (version == null) {
        await vfs.write(path, content, {versionCheck: false});
      } else {
        await vfs.write(path, content, {
          expectedVersion: version,
          versionCheck: true,
        });
      }
      setSavedContent(content);
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

  const dismissEditor = useCallback(() => {
    codeEditorRef.current?.blur();
    setEditorFocused(false);
    Keyboard.dismiss();
  }, []);

  const togglePreview = () => {
    if (!previewMode) {
      dismissEditor();
    }
    setPreviewMode(prev => !prev);
  };

  // 进入编辑态时默认未弹键盘，便于滑动浏览正文。
  useEffect(() => {
    if (!previewMode) {
      setEditorFocused(false);
    }
  }, [previewMode]);

  const annotateEnabled = shouldEnableFileAnnotate({
    previewMode,
    scopeKind,
    sessionId,
  });

  if (loading) {
    return (
      <View style={[styles.center, {backgroundColor: tokens.background}]}>
        <ActivityIndicator color={tokens.primary} />
      </View>
    );
  }

  const statsRow =
    mtimeMs != null ? (
      editorFocused && !previewMode ? (
        <Pressable
          testID="file-editor-dismiss-stats"
          style={[styles.statsRow, {borderBottomColor: tokens.border}]}
          onPress={dismissEditor}
          accessibilityRole="button"
          accessibilityLabel="收起键盘"
        >
          <Text
            style={[styles.statsText, {color: tokens.textSecondary}]}
            numberOfLines={1}
          >
            更新于 {formatFileMtime(mtimeMs)} ·{' '}
            {formatCharCount(content.length)} 字
            {isDirty ? ' · 编辑中未保存' : ''}
          </Text>
        </Pressable>
      ) : (
        <View style={[styles.statsRow, {borderBottomColor: tokens.border}]}>
          <Text
            style={[styles.statsText, {color: tokens.textSecondary}]}
            numberOfLines={1}
          >
            更新于 {formatFileMtime(mtimeMs)} ·{' '}
            {formatCharCount(content.length)} 字
            {isDirty ? ' · 编辑中未保存' : ''}
          </Text>
        </View>
      )
    ) : null;

  // 预览无软键盘；编辑态键盘抬升/裁切分支由 EditorScreenShell 统一处理。
  return (
    <EditorScreenShell
      tokens={tokens}
      toolbarBorderColor={tokens.border}
      save={{
        testID: 'file-editor-save',
        label: saving ? '保存中…' : '保存',
        disabled: saving || !isDirty || previewMode || isReadOnly,
        onPress: () => handleSave().catch(() => undefined),
      }}
      title={isDirty ? '未保存' : vfsBasename(path)}
      titleDanger={isDirty}
      titlePress={
        editorFocused && !previewMode
          ? {testID: 'file-editor-dismiss-toolbar', onPress: dismissEditor}
          : undefined
      }
      toggle={isReadOnly ? undefined : {previewMode, onPress: togglePreview}}
      toolbarExtra={statsRow}
      segmented={{
        options: [
          {value: 'markdown', label: 'Markdown'},
          {value: 'txt', label: '文本'},
        ],
        value: previewRenderKind,
        onChange: setPreviewRenderKind,
      }}
      previewMode={previewMode}
      preview={
        heavyPreviewReady ? (
          <FileMarkdownPreview
            path={path}
            content={content}
            tokens={tokens}
            previewFill
            renderKind={previewRenderKind}
            annotateEnabled={annotateEnabled}
            sessionId={annotateEnabled ? sessionId : undefined}
          />
        ) : (
          <View style={styles.previewLoading}>
            <ActivityIndicator size="large" color={tokens.primary} />
          </View>
        )
      }
      editor={
        <CodeEditorWebView
          ref={codeEditorRef}
          testID="file-editor-input"
          value={content}
          path={path}
          onChange={setContent}
          onFocusChange={setEditorFocused}
          style={styles.editor}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  center: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  statsRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statsText: {fontSize: 12},
  previewLoading: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  editor: {flex: 1, minHeight: 0},
});
