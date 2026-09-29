/**
 * 全屏编辑页：智能体配置的提示词字段（R3→R6 起）与 chat 输入框全屏
 * （composer-webview 起）共用的同一个编辑屏——顶栏照搬工作区
 * FileEditorScreen：左「保存」+ 中 标题/「未保存」+ 右「编辑/预览」单按钮互切
 * （切换与预览**只属于 form 变体**，见下）。
 *
 * 两个变体由 `route.params.variant` 决定：
 * - `form`（缺省，提示词字段）：保存语义同工作区——保存后停留在当前态、清除
 *   未保存标记、toast 提示；区别在于没有 VFS 写入，保存只发 onSaved 回调
 *   （回填调用方表单）。退出走 header 返回/手势，未保存改动由 useUnsavedGuard
 *   弹确认拦截（与工作区同款），确认离开即丢弃草稿。预览按 markdown 渲染
 *   （FileMarkdownPreview 只吃内存 content，不涉及 VFS 读写）。
 * - `composer`（chat 输入框 ⛶）：**纯编辑态**——用户定案「输入框全屏只要编辑」
 *   （2026-09-29），不传 toggle/segmented/preview，也没有「保存」概念：这块文本
 *   本来就是输入框内容，**退出即回填**（卸载时发 onSaved），所以不渲染左位保存
 *   按钮、也不拦退出（无「丢掉」可言）。进全屏前调用方已把当前文本交进来，退出
 *   后原样回到输入框。编辑区仍是 CodeEditorWebView（用户拍板不换引擎），但走
 *   composer 伪路径（COMPOSER_EDITOR_PATH）激活 **skill/@ tag 胶囊**——
 *   CodeMirror 侧 mark 装饰 + atomicRanges 原子删（web/code-editor 的
 *   composer-tokens 扩展），插入链（typeahead / @/$ 选择器）与内联输入框
 *   （ChatComposer）同款：`$`/`@` 手输触发 typeahead，底排按钮开选择器，
 *   buildTokenInsertion 统一拼 token 与光标。路由需带 projectId/sessionId
 *   （ChatTabScreen 负责），缺省时 tag 高亮仍在、typeahead/选择器静默降级。
 *
 * 回调不走路由参数（不可序列化），挂载时从模块级存取取走（读后即清）。
 * 顶栏/预览二态/键盘三分支外壳由 components/chrome/EditorScreenShell 统一
 * 提供（与工作区 FileEditorScreen 共用）。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useRoute, type RouteProp} from '@react-navigation/native';
import type {RootStackParamList} from '../../navigation/types';
import {useStackOverrideSetter} from '../../navigation/HeaderContext';
import {useUnsavedGuard} from '../../hooks/useUnsavedGuard';
import {useToast} from '../../components/chrome/ToastHost';
import {
  CodeEditorWebView,
  type CodeEditorWebViewHandle,
} from '../../components/vfs/CodeEditorWebView';
import {
  FileMarkdownPreview,
  type PreviewRenderKind,
} from '../../components/vfs/FileMarkdownPreview';
import {EditorScreenShell} from '../../components/chrome/EditorScreenShell';
import {
  takePromptEditorOnSaved,
  type PromptEditorOnSaved,
} from '../../components/agent/prompt-editor-callback';
import {AtPathTypeahead} from '../../components/chat/AtPathTypeahead';
import {
  filterSkillTypeaheadCandidates,
  SkillTypeahead,
} from '../../components/chat/SkillTypeahead';
import {
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  type AtPathRef,
} from '../../components/chat/composer-at-path';
import {
  buildTokenInsertion,
  type ComposerTokenInsertion,
} from '../../components/chat/composer-token-insert';
import {FileReferencePicker} from '../../components/chat/FileReferencePicker';
import {SkillPicker} from '../../components/skills/SkillPicker';
import type {EffectiveSkill} from '@novel-master/core/skills';
import type {WorkplaceListRow} from '@novel-master/core/workplace';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {useTheme} from '../../theme/ThemeProvider';

/** 伪路径以 .md 结尾：编辑器按 markdown 高亮，预览走 markdown 渲染管线。 */
const PROMPT_EDITOR_PATH = 'prompt.md';

/**
 * composer 变体伪路径：web 侧 code-editor 的 `COMPOSER_TOKEN_PATH` 同值镜像
 * ——命中即挂胶囊扩展（@/$ token 高亮 + 原子删），改这里必须同步 web 侧。
 */
const COMPOSER_EDITOR_PATH = 'composer.md';

/**
 * 页内 toolbar 标题缺省值（仅 form 变体用；composer 变体不渲染 toolbar，
 * 它的「编辑消息」走导航栏标题）。
 */
const DEFAULT_FORM_TITLE = '提示词';

type PromptEditorRoute = RouteProp<RootStackParamList, 'PromptEditor'>;

export function PromptEditorScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const route = useRoute<PromptEditorRoute>();
  const {title, initialText, variant = 'form', projectId, sessionId} =
    route.params;
  const isComposer = variant === 'composer';
  // 屏级 override：自动带 ownerRouteKey，转场期间不泄漏到相邻屏 header。
  const setStackOverride = useStackOverrideSetter();
  // 回调走模块级存取（路由参数必须可序列化）：挂载时读走并清空，
  // 未消费即离开时不残留旧回调。composer 变体在卸载时消费（退出即回填）。
  const onSavedRef = useRef<PromptEditorOnSaved | null>(
    takePromptEditorOnSaved(),
  );
  // 屏内草稿 + 已保存基线（照 FileEditorScreen 的 content/savedContent 对）：
  // form 保存只回填调用方并推进基线，不离开页面；composer 无基线消费方。
  const [draft, setDraft] = useState(initialText);
  const [savedDraft, setSavedDraft] = useState(initialText);
  // 编辑/预览切换（照 FileEditorScreen）：入口按钮叫「全屏编辑」，
  // 进屏默认编辑态；预览渲染当前草稿。
  const [previewMode, setPreviewMode] = useState(false);
  const [previewRenderKind, setPreviewRenderKind] =
    useState<PreviewRenderKind>('markdown');
  const codeEditorRef = useRef<CodeEditorWebViewHandle>(null);

  /* ---- composer 变体的 tag 插入链（typeahead / 选择器；form 变体不参与） ---- */
  const {runtime} = useNovelMaster();
  /** 光标（typeahead 活跃查询判定用；来自 web 选区上报）。 */
  const [cursor, setCursor] = useState(0);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [pathPickerOpen, setPathPickerOpen] = useState(false);
  /** `$` 技能 typeahead 候选源（当前项目合并视图，不走会话工作区）。 */
  const [skillRows, setSkillRows] = useState<EffectiveSkill[]>([]);
  /** `@` 路径 typeahead 候选源（会话工作区行）。 */
  const [typeaheadRows, setTypeaheadRows] = useState<WorkplaceListRow[]>([]);

  /** typeahead/选择器可用：composer 变体且路由带齐 scope（旧调用方缺参时降级）。 */
  const canTypeahead = isComposer && projectId != null && sessionId != null;
  const activeAt = canTypeahead ? findActiveAtQuery(draft, cursor) : null;
  const activeSkill = canTypeahead
    ? findActiveAtQuery(draft, cursor, '$')
    : null;
  /** 活跃查询的开关位（effect 依赖用布尔常量，避免复杂表达式进 deps）。 */
  const atQueryActive = activeAt != null;
  const skillQueryActive = activeSkill != null;

  // `$` 技能候选：当前项目合并视图（与 ChatComposer 同源同口径）
  useEffect(() => {
    if (!canTypeahead || !skillQueryActive || projectId == null) {
      return;
    }
    let cancelled = false;
    const rt = runtime;
    if (rt == null) {
      return;
    }
    void (async () => {
      try {
        const list = await rt.skills().effectiveSkills(projectId);
        if (!cancelled) {
          setSkillRows(list);
        }
      } catch {
        if (!cancelled) {
          setSkillRows([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canTypeahead, skillQueryActive, projectId, runtime]);

  // `@` 路径候选：会话工作区行（与 ChatComposer 同源同口径）
  useEffect(() => {
    if (!canTypeahead || !atQueryActive || sessionId == null) {
      return;
    }
    let cancelled = false;
    const rt = runtime;
    if (rt == null) {
      return;
    }
    void (async () => {
      try {
        const session = await rt.sessions.get(sessionId);
        const worktree = rt.workplace({
          kind: 'session',
          projectId: session.projectId,
          sessionId,
        });
        const rows = await worktree.buildListRows();
        if (!cancelled) {
          setTypeaheadRows(rows);
        }
      } catch {
        if (!cancelled) {
          setTypeaheadRows([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canTypeahead, atQueryActive, sessionId, runtime]);

  const typeaheadCandidates = (() => {
    if (activeAt == null) {
      return [] as AtPathRef[];
    }
    const refs: AtPathRef[] = typeaheadRows
      .filter(r => r.path !== '/')
      .map(r => ({
        path: r.path,
        kind: r.kind === 'dir' ? ('dir' as const) : ('file' as const),
      }));
    return filterAtPathTypeaheadCandidates(refs, activeAt.query, 5);
  })();

  const skillTypeaheadCandidates =
    activeSkill == null
      ? []
      : filterSkillTypeaheadCandidates(skillRows, activeSkill.query, 5);

  /** 提交 token 插入：web 一次写入 + 光标落位，本地草稿/光标同步推进。 */
  const commitDraft = useCallback((next: ComposerTokenInsertion) => {
    codeEditorRef.current?.setText(next.text, {
      start: next.cursor,
      end: next.cursor,
    });
    setDraft(next.text);
    setCursor(next.cursor);
  }, []);

  /** `@` typeahead 点选：从活跃 `@` 起替换到光标（plain + 尾空格）。 */
  const applyTypeaheadToken = useCallback(
    (token: string) => {
      if (activeAt == null) {
        return;
      }
      commitDraft(buildTokenInsertion(draft, cursor, activeAt.start, token));
    },
    [activeAt, cursor, draft, commitDraft],
  );

  /** `$` typeahead 点选：插 `$技能名` token。 */
  const applySkillTypeaheadToken = useCallback(
    (skillName: string) => {
      if (activeSkill == null) {
        return;
      }
      commitDraft(
        buildTokenInsertion(draft, cursor, activeSkill.start, `$${skillName}`),
      );
    },
    [activeSkill, cursor, draft, commitDraft],
  );

  /** SkillPicker 单选：从光标（或活跃 `$` 查询）处插入 `$技能名` token。 */
  const insertSkillToken = useCallback(
    (skillName: string) => {
      // 有未完成 $… 时从 $ 起替换到光标，避免残留半截查询
      const replaceStart = activeSkill != null ? activeSkill.start : cursor;
      commitDraft(
        buildTokenInsertion(draft, cursor, replaceStart, `$${skillName}`),
      );
    },
    [activeSkill, cursor, draft, commitDraft],
  );

  /** FileReferencePicker 多选：`@path` token 以空格连接插入。 */
  const insertPathTokens = useCallback(
    (pathTokens: readonly string[]) => {
      if (pathTokens.length === 0) {
        return;
      }
      const replaceStart = activeAt != null ? activeAt.start : cursor;
      commitDraft(
        buildTokenInsertion(draft, cursor, replaceStart, pathTokens),
      );
    },
    [activeAt, cursor, draft, commitDraft],
  );

  const handleSelectionChange = useCallback((selection: {start: number}) => {
    setCursor(selection.start);
  }, []);

  const isDirty = draft !== savedDraft;
  // composer 变体不拦退出：文本退出即回填，没有「丢掉改动」这回事。
  useUnsavedGuard(!isComposer && isDirty);

  // 退出即回填（composer）：卸载点覆盖 header 返回与手势返回两条路。
  // 用 ref 取当拍草稿，effect 不随每次输入重挂（否则会中途提前回填）。
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!isComposer) {
      return undefined;
    }
    return () => {
      onSavedRef.current?.(draftRef.current);
      onSavedRef.current = null;
    };
  }, [isComposer]);

  // 路由 title 参数可覆盖 header 静态标题（仿 ProviderDetail 的 stackOverride 用法）。
  useEffect(() => {
    if (!title) {
      return;
    }
    setStackOverride({title});
    return () => setStackOverride(undefined);
  }, [title, setStackOverride]);

  const togglePreview = useCallback(() => {
    setPreviewMode(prev => {
      // 离开编辑态时收起编辑器焦点与软键盘（照 FileEditorScreen 的 dismissEditor）。
      if (!prev) {
        codeEditorRef.current?.blur();
        Keyboard.dismiss();
      }
      return !prev;
    });
  }, []);

  // 保存（照 FileEditorScreen handleSave 的可保存条件）：编辑态且有改动才生效。
  // 无 VFS 写入：发 onSaved 回调 + 推进基线 + toast，停留在当前态。仅 form 变体。
  const handleSave = useCallback(() => {
    if (previewMode || !isDirty) {
      return;
    }
    onSavedRef.current?.(draft);
    setSavedDraft(draft);
    showToast('已保存');
  }, [previewMode, isDirty, draft, showToast]);

  // 预览态无软键盘，直接铺开；编辑态键盘抬升/裁切分支由 EditorScreenShell 统一处理。
  return (
    <>
      <EditorScreenShell
        tokens={tokens}
        toolbarBorderColor={tokens.borderLight}
        save={
          isComposer
            ? undefined
            : {
                testID: 'prompt-editor-save',
                accessibilityLabel: '保存',
                label: '保存',
                disabled: previewMode || !isDirty,
                onPress: handleSave,
              }
        }
        /* composer 变体不传 title：页内 toolbar 整行不渲染——导航栏已经有「编辑消息」
           （route.params.title → stackOverride），页内再居中写一个就是两个标题叠着。 */
        title={isComposer ? undefined : isDirty ? '未保存' : title ?? DEFAULT_FORM_TITLE}
        titleDanger={!isComposer && isDirty}
        /* composer 变体是**纯编辑态**（用户定案：输入框全屏只要编辑，不要预览）：
           不传 toggle / segmented / preview，shell 只渲染编辑器。 */
        toggle={
          isComposer
            ? undefined
            : {
                testID: 'prompt-editor-toggle',
                accessibilityLabel: previewMode ? '编辑' : '预览',
                previewMode,
                onPress: togglePreview,
              }
        }
        segmented={
          isComposer
            ? undefined
            : {
                options: [
                  {value: 'markdown', label: 'Markdown'},
                  {value: 'txt', label: '文本'},
                ],
                value: previewRenderKind,
                onChange: setPreviewRenderKind,
              }
        }
        previewMode={isComposer ? false : previewMode}
        preview={
          isComposer ? undefined : (
            <FileMarkdownPreview
              path={PROMPT_EDITOR_PATH}
              content={draft}
              tokens={tokens}
              previewFill
              renderKind={previewRenderKind}
            />
          )
        }
        editor={
          isComposer ? (
            <View style={styles.composerWrap}>
              <CodeEditorWebView
                ref={codeEditorRef}
                value={draft}
                path={COMPOSER_EDITOR_PATH}
                onChange={setDraft}
                onSelectionChange={handleSelectionChange}
              />
              {/* typeahead 浮层：底部动作行上方（键盘起时随编辑区一起抬升） */}
              <View pointerEvents="box-none" style={styles.typeaheadDock}>
                <AtPathTypeahead
                  open={activeAt != null}
                  candidates={typeaheadCandidates}
                  onSelect={applyTypeaheadToken}
                />
                <SkillTypeahead
                  open={activeSkill != null}
                  candidates={skillTypeaheadCandidates}
                  onSelect={applySkillTypeaheadToken}
                />
              </View>
              {/* 底排动作行：@ / $ 同款 36 圆钮（与 ChatComposer 工具栏一致） */}
              <View style={[styles.actionRow, {borderTopColor: tokens.border}]}>
                <Pressable
                  testID="composer-editor-at-btn"
                  onPress={() => setPathPickerOpen(true)}
                  disabled={!canTypeahead}
                  style={[styles.actionBtn, {borderColor: tokens.border}]}
                  accessibilityLabel="引用文件"
                >
                  <Text style={{color: tokens.textSecondary, fontSize: 16}}>
                    @
                  </Text>
                </Pressable>
                <Pressable
                  testID="composer-editor-skill-btn"
                  onPress={() => setSkillPickerOpen(true)}
                  disabled={!canTypeahead}
                  style={[styles.actionBtn, {borderColor: tokens.border}]}
                  accessibilityLabel="引用技能"
                >
                  <Text style={{color: tokens.textSecondary, fontSize: 16}}>
                    $
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <CodeEditorWebView
              ref={codeEditorRef}
              value={draft}
              path={PROMPT_EDITOR_PATH}
              onChange={setDraft}
            />
          )
        }
      />
      {isComposer && projectId != null && sessionId != null ? (
        <>
          <FileReferencePicker
            visible={pathPickerOpen}
            projectId={projectId}
            sessionId={sessionId}
            onClose={() => setPathPickerOpen(false)}
            onConfirm={insertPathTokens}
          />
          <SkillPicker
            visible={skillPickerOpen}
            projectId={projectId}
            onClose={() => setSkillPickerOpen(false)}
            onConfirm={insertSkillToken}
          />
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  composerWrap: {flex: 1, minHeight: 0},
  /** 浮层锚在动作行上方；列表关闭时子组件渲染 null，不挡编辑区触摸。 */
  typeaheadDock: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 56,
    zIndex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  /** 与 ChatComposer 的 toolBtn 同款：36 圆钮 + 细描边。 */
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
