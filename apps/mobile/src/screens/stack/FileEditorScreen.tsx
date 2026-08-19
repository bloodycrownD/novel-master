/**
 * Full-screen file editor: read VFS, save via scoped vfs.write (no checkpoint).
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  KeyboardAvoidingView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/types';
import type {VfsService} from '@novel-master/core/vfs';
import {useRuntime} from '../../hooks/useRuntime';
import {useUnsavedGuard} from '../../hooks/useUnsavedGuard';
import {toastMessage} from '../../errors/toast-message';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {sessionSaveVfsFile} from '../../services/vfs-operations.service';
import { isUserVfsUnifiedToolTurnEnabled } from "@novel-master/core/feature-flags";
import {
  FileMarkdownPreview,
  isMarkdownPreviewPath,
} from '../../components/vfs/FileMarkdownPreview';
import {shouldEnableFileAnnotate} from '../../components/vfs/file-annotate-gate';
import {
  CodeEditorWebView,
  type CodeEditorWebViewHandle,
} from '../../components/vfs/CodeEditorWebView';
import {SegmentedControl} from '../../components/ui/SegmentedControl';
import {formatCharCount} from '@novel-master/core/format';

/**
 * Android：与聊天页同款——裁切窗口用 marginBottom 收缩键盘高度，
 * 内容区（flex:1）跟着缩到键盘以上。不能只 translateY：body 高度不变的话
 * 顶部会被 overflow:hidden 裁掉，未行够不着、也滚动不了。
 */
function AndroidKeyboardFileEditorBody({
  children,
}: {
  children: React.ReactNode;
}) {
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  // hook 返回的 height 是负数，取反得到正的键盘高度。
  const clipStyle = useAnimatedStyle(() => {
    return { marginBottom: -keyboardHeightSV.value };
  }, [keyboardHeightSV]);

  return (
    <Animated.View style={[styles.keyboardClip, clipStyle]}>
      <View style={styles.keyboardLiftBody}>{children}</View>
    </Animated.View>
  );
}

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
  // [swipe-debug] 临时诊断日志（定位侧滑退出失效，确认后移除）：
  // focus/blur/beforeRemove 事件流 + 内容加载时序，核对侧滑是否产生 POP、
  // 以及手势时刻 JS 是否正被渲染占着。
  const dbgNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  useEffect(() => {
    console.log(
      `[swipe-debug] FileEditor mount path=${route.params.path} scope=${route.params.scopeKind} @${Date.now()}`,
    );
    const focusSub = dbgNav.addListener('focus', () =>
      console.log(`[swipe-debug] FileEditor focus @${Date.now()}`),
    );
    const blurSub = dbgNav.addListener('blur', () =>
      console.log(`[swipe-debug] FileEditor blur @${Date.now()}`),
    );
    const removeSub = dbgNav.addListener('beforeRemove', e =>
      console.log(
        `[swipe-debug] FileEditor beforeRemove type=${e.data.action.type} @${Date.now()}`,
      ),
    );
    return () => {
      focusSub();
      blurSub();
      removeSub();
    };
  }, [dbgNav, route.params.path, route.params.scopeKind]);
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
    const timer = setTimeout(() => {
      console.log(
        `[swipe-debug] FileEditor heavy preview mounting (WebView) @${Date.now()}`,
      );
      setHeavyPreviewReady(true);
    }, 80);
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
        console.log(
          `[swipe-debug] FileEditor content loaded len=${result.content.length} @${Date.now()}`,
        );
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

  const editorBody = (
    <>
      <View style={[styles.toolbar, {borderBottomColor: tokens.border}]}>
        <Pressable
          testID="file-editor-save"
          style={styles.toolbarBtn}
          onPress={() => handleSave().catch(() => undefined)}
          disabled={saving || !isDirty || previewMode || isReadOnly}>
          <Text
            style={{
              color:
                isDirty && !saving && !previewMode && !isReadOnly
                  ? tokens.primary
                  : tokens.textSecondary,
            }}>
            {saving ? '保存中…' : '保存'}
          </Text>
        </Pressable>
        {/* Show basename only; tail ellipsis when the filename is long. */}
        {editorFocused && !previewMode ? (
          <Pressable
            testID="file-editor-dismiss-toolbar"
            style={styles.toolbarPath}
            onPress={dismissEditor}
            accessibilityRole="button"
            accessibilityLabel="收起键盘">
            <Text
              style={[
                styles.toolbarPathText,
                {color: isDirty ? tokens.danger : tokens.textSecondary},
              ]}
              numberOfLines={1}
              ellipsizeMode="tail">
              {isDirty ? '未保存' : vfsBasename(path)}
            </Text>
          </Pressable>
        ) : (
          <Text
            style={[
              styles.toolbarPath,
              styles.toolbarPathText,
              {color: isDirty ? tokens.danger : tokens.textSecondary},
            ]}
            numberOfLines={1}
            ellipsizeMode="tail">
            {isDirty ? '未保存' : vfsBasename(path)}
          </Text>
        )}
        {!isReadOnly ? (
          <Pressable style={styles.toolbarBtn} onPress={togglePreview}>
            <Text
              style={{
                color: previewMode ? tokens.primary : tokens.textSecondary,
              }}>
              {previewMode ? '编辑' : '预览'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {mtimeMs != null ? (
        editorFocused && !previewMode ? (
          <Pressable
            testID="file-editor-dismiss-stats"
            style={[styles.statsRow, {borderBottomColor: tokens.border}]}
            onPress={dismissEditor}
            accessibilityRole="button"
            accessibilityLabel="收起键盘">
            <Text
              style={[styles.statsText, {color: tokens.textSecondary}]}
              numberOfLines={1}>
              更新于 {formatFileMtime(mtimeMs)} · {formatCharCount(content.length)} 字
              {isDirty ? ' · 编辑中未保存' : ''}
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.statsRow, {borderBottomColor: tokens.border}]}>
            <Text
              style={[styles.statsText, {color: tokens.textSecondary}]}
              numberOfLines={1}>
              更新于 {formatFileMtime(mtimeMs)} · {formatCharCount(content.length)} 字
              {isDirty ? ' · 编辑中未保存' : ''}
            </Text>
          </View>
        )
      ) : null}
      {previewMode ? (
        <SegmentedControl
          options={[
            {value: 'markdown', label: 'Markdown'},
            {value: 'txt', label: '文本'},
          ]}
          value={previewRenderKind}
          onChange={setPreviewRenderKind}
          tokens={tokens}
        />
      ) : null}
      {previewMode ? (
        /* WebView owns scroll — no outer ScrollView (avoids nested scroll + height bugs). */
        <View style={[styles.preview, {backgroundColor: tokens.surface}]}>
          {heavyPreviewReady ? (
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
          )}
        </View>
      ) : (
        <CodeEditorWebView
          ref={codeEditorRef}
          testID="file-editor-input"
          value={content}
          path={path}
          onChange={setContent}
          onFocusChange={setEditorFocused}
          style={styles.editor}
        />
      )}
    </>
  );

  const rootStyle = [styles.root, {backgroundColor: tokens.background}];

  // 预览无软键盘；编辑态 Android 抬升（同聊天页），iOS 仍用 KAV padding。
  if (previewMode) {
    return <View style={rootStyle}>{editorBody}</View>;
  }

  if (Platform.OS === 'android') {
    return (
      <View style={rootStyle}>
        <AndroidKeyboardFileEditorBody>{editorBody}</AndroidKeyboardFileEditorBody>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={rootStyle}
      behavior="padding"
      automaticOffset>
      {editorBody}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  keyboardClip: {flex: 1, minHeight: 0, overflow: 'hidden'},
  keyboardLiftBody: {flex: 1, minHeight: 0},
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarBtn: {
    flexShrink: 0,
  },
  toolbarPath: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  toolbarPathText: {
    textAlign: 'center',
  },
  statsRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statsText: {fontSize: 12},
  preview: {flex: 1, minHeight: 0, padding: 12},
  previewLoading: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  editor: {flex: 1, minHeight: 0},
});
