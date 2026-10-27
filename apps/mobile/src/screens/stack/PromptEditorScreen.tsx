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
 *   composer-tokens 扩展），底排 `@`/`$` 按钮开选择器（FileReferencePicker /
 *   SkillPicker），插入链与内联输入框（ChatComposer）同款：buildTokenInsertion
 *   统一拼 token 与光标。路由需带 projectId/sessionId（ChatTabScreen 负责），
 *   缺省时 tag 高亮仍在、选择器静默降级。
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
import {composerAtPath} from '../../components/chat/composer-at-path';
import {
  buildTokenInsertion,
  queryWithinConfirmedRange,
  type ComposerTokenInsertion,
} from '../../components/chat/composer-token-insert';
import {remapTokenRanges} from '../../components/chat/native-composer/token-ranges';
import type {ComposerDraftTokenRange} from '@novel-master/core/chat';
import {FileReferencePicker} from '../../components/chat/FileReferencePicker';
import {SkillPicker} from '../../components/skills/SkillPicker';
import {composerToolBtnStyle} from '../../components/chat/composer-toolbar-style';
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
  const {
    title,
    initialText,
    variant = 'form',
    projectId,
    sessionId,
    tokenRanges: initialTokenRanges,
  } = route.params;
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
  /** 当拍草稿镜像：插入链与卸载回填（effect 不重挂）共用的同步读取点。 */
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // 编辑/预览切换（照 FileEditorScreen）：入口按钮叫「全屏编辑」，
  // 进屏默认编辑态；预览渲染当前草稿。
  const [previewMode, setPreviewMode] = useState(false);
  const [previewRenderKind, setPreviewRenderKind] =
    useState<PreviewRenderKind>('markdown');
  const codeEditorRef = useRef<CodeEditorWebViewHandle>(null);

  /* ---- composer 变体的 tag 插入链（选择器；form 变体不参与） ---- */
  const {runtime} = useNovelMaster();
  /** 光标（`@`/`$` 半截查询识别用；来自 web 选区上报）。
   * 初值＝文末：进全屏不点正文直接插 token 时落在末尾（与 web 侧 mount 默认
   * 选区成对——CM 挂载不触发 selectionChange，RN 侧若停在 0 会插到整篇开头）。 */
  const [cursor, setCursor] = useState(() =>
    isComposer ? (initialText ?? '').length : 0,
  );
  /**
   * 最近一次选区的右缘（D11 删除锚的取值基准）：只在选区回调与命令式写入
   * 落位时显式推进，不随渲染从 `cursor` state 回灌——state 存的是 start
   * （活跃查询判定用），非折叠选区时两者不同。
   */
  const selectionEndRef = useRef(cursor);
  /**
   * 编辑前光标快照（D11 删除锚，全屏侧）。
   *
   * web 侧 CodeMirror 的选区上报与文本变更走两条消息：选区在 update listener
   * 里**同步**上报，文本变更经 rAF 合帧后才上发（`editor.ts` 的
   * `scheduleChangePost`）。也就是说打字/删除时 RN 先收到「变更后选区」、
   * 后收到新正文——直接把最新选区当编辑前光标会把删除锚指错位置。这里按
   * 「上一拍」留快照：每次选区上报先把旧值存进来再推进镜像，文本变更事件
   * 读到的就是变更前光标；纯点选没有后续变更，下一次上报会自然把它推进到
   * 最新位置（打字事务自带一遍选区上报）。
   */
  const prevCursorRef = useRef<number | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [pathPickerOpen, setPathPickerOpen] = useState(false);

  /** 选择器可用（按钮 disabled 与 Picker 挂载共用判据）：composer 变体、路由
   * 带齐 scope 且 runtime 就绪（选择器内部走 useRuntime 会抛——未就绪时静默
   * 降级，旧调用方缺参同理）。 */
  const canOpenPicker =
    isComposer && projectId != null && sessionId != null && runtime != null;
  /** 活跃的 `@`/`$` 半截查询：Picker 确认时从查询起点替换到光标（不残留半截）。 */
  const activeAt = canOpenPicker ? composerAtPath.detectQuery(draft, cursor) : null;
  const activeSkill = canOpenPicker
    ? composerAtPath.detectQuery(draft, cursor, '$')
    : null;

  /**
   * 全屏侧的确认胶囊区间：进入全屏时路由带入的草稿 `tokenRanges`（ChatTabScreen
   * 透传）+ 本次会话内新插入的胶囊。守卫与 dock 同口径
   * （`queryWithinConfirmedRange` 共享纯函数）：chip 零空格插入后光标贴 token
   * 右缘，不守的话第二次确认会把上一颗整颗替换。
   */
  const confirmedRangesRef = useRef<readonly ComposerDraftTokenRange[]>(
    initialTokenRanges ?? [],
  );

  /**
   * 确认区间推进（全屏版 `advanceTokenRanges`）：先按文本差分 remap 旧区间
   * （用户在编辑器里打字/删除时区间随正文走），再拼接本次插入登记的新区间。
   * 守卫读到的区间必须始终对应当前正文，否则删改后的陈旧区间会误判/漏判。
   * `nextCursor` 是插入落文后的光标（chip 纯插入锚）：不传时差分对齐会把
   * 「新 token 插在旧 token 头部」的公共触发符咬进旧区间，与 dock 同口径传。
   * `prevCursor` 是编辑前光标（D11 删除锚）：全屏内删相邻胶囊左颗时，靠它
   * 反推真实删除段，幸存区间才不会被子差分对齐误摘——与 dock 语义一致。
   */
  const advanceConfirmedRanges = useCallback(
    (
      prevText: string,
      nextText: string,
      inserted: readonly ComposerDraftTokenRange[] = [],
      nextCursor?: number,
      prevCursor?: number,
    ) => {
      const remapped = remapTokenRanges(
        prevText,
        nextText,
        confirmedRangesRef.current,
        nextCursor,
        prevCursor,
      );
      confirmedRangesRef.current =
        inserted.length > 0
          ? [...remapped, ...inserted].sort((a, b) => a.start - b.start)
          : remapped;
    },
    [],
  );

  /** 编辑器打字/删除：草稿与确认区间一起推进（programmatic setText 无回声）。 */
  const handleDraftChange = useCallback(
    (nextText: string) => {
      // D11 删除锚：编辑前光标（选区上报的上一拍，见 prevCursorRef 注释）。
      advanceConfirmedRanges(
        draftRef.current,
        nextText,
        undefined,
        undefined,
        prevCursorRef.current ?? undefined,
      );
      draftRef.current = nextText;
      setDraft(nextText);
    },
    [advanceConfirmedRanges],
  );

  /** 提交 token 插入：web 一次写入 + 光标落位，本地草稿/光标/区间同步推进。 */
  const commitDraft = useCallback(
    (next: ComposerTokenInsertion) => {
      advanceConfirmedRanges(
        draftRef.current,
        next.text,
        next.tokenRanges,
        next.cursor,
      );
      draftRef.current = next.text;
      codeEditorRef.current?.setText(next.text, {
        start: next.cursor,
        end: next.cursor,
      });
      setDraft(next.text);
      setCursor(next.cursor);
      // 命令式写入的落位同步进镜像（与 dock 的 controller 同款）：下一次
      // 打字事件读到的「编辑前光标」不能沿用插入前的旧选区。
      selectionEndRef.current = next.cursor;
      prevCursorRef.current = next.cursor;
    },
    [advanceConfirmedRanges],
  );

  /** SkillPicker 单选：从光标（或活跃 `$` 查询）处插入 `$技能名` token。 */
  const insertSkillToken = useCallback(
    (skillName: string) => {
      // 有未完成 $… 时从 $ 起替换到光标，避免残留半截查询；但整段落进已确认
      // 胶囊的查询是成品胶囊（光标贴其尾部），纯插入不替换。
      const replaceStart =
        activeSkill != null &&
        !queryWithinConfirmedRange(
          confirmedRangesRef.current,
          activeSkill.start,
          cursor,
        )
          ? activeSkill.start
          : cursor;
      commitDraft(
        buildTokenInsertion(draft, cursor, replaceStart, `$${skillName}$`),
      );
    },
    [activeSkill, cursor, draft, commitDraft],
  );

  /** FileReferencePicker 多选：`@path` token 零分隔空格直插（chip 口径）。 */
  const insertPathTokens = useCallback(
    (pathTokens: readonly string[]) => {
      if (pathTokens.length === 0) {
        return;
      }
      const replaceStart =
        activeAt != null &&
        !queryWithinConfirmedRange(
          confirmedRangesRef.current,
          activeAt.start,
          cursor,
        )
          ? activeAt.start
          : cursor;
      commitDraft(
        buildTokenInsertion(
          draft,
          cursor,
          replaceStart,
          // picker 交上来的是裸 `@path`：终止符在 composer 侧补（picker 与目录移动共用）
          pathTokens.map(token => `${token}@`),
        ),
      );
    },
    [activeAt, cursor, draft, commitDraft],
  );

  const handleSelectionChange = useCallback(
    (selection: {start: number; end: number}) => {
      // 快照上一拍选区右缘再推进镜像（D11 删除锚，与 controller 的
      // `onSelectionChange` 同口径——选区删除后光标落起点，右缘才贴着删除段）：
      // web 侧选区上报先于文本变更（见 prevCursorRef 注释），change 到达时
      // 这里留着的就是编辑前光标。
      prevCursorRef.current = selectionEndRef.current;
      selectionEndRef.current = selection.end;
      setCursor(selection.start);
    },
    [],
  );

  const isDirty = draft !== savedDraft;
  // composer 变体不拦退出：文本退出即回填，没有「丢掉改动」这回事。
  useUnsavedGuard(!isComposer && isDirty);

  // 退出即回填（composer）：卸载点覆盖 header 返回与手势返回两条路。
  // 用 ref 取当拍草稿，effect 不随每次输入重挂（否则会中途提前回填）。
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
                onChange={handleDraftChange}
                onSelectionChange={handleSelectionChange}
              />
              {/* 底排动作行：@ / $ 同款 36 圆钮（与 ChatComposer 工具栏同源单一样式） */}
              <View style={[styles.actionRow, {borderTopColor: tokens.border}]}>
                <Pressable
                  testID="composer-editor-at-btn"
                  onPress={() => setPathPickerOpen(true)}
                  disabled={!canOpenPicker}
                  style={[composerToolBtnStyle, {borderColor: tokens.border}]}
                  accessibilityLabel="引用文件"
                >
                  <Text style={{color: tokens.textSecondary, fontSize: 16}}>
                    @
                  </Text>
                </Pressable>
                <Pressable
                  testID="composer-editor-skill-btn"
                  onPress={() => setSkillPickerOpen(true)}
                  disabled={!canOpenPicker}
                  style={[composerToolBtnStyle, {borderColor: tokens.border}]}
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
      {/* 挂载判据与按钮 disabled 同源（canOpenPicker）：选择器内部走
          useRuntime()，未就绪渲染即抛——缺 scope / runtime 时静默降级不挂载。 */}
      {canOpenPicker ? (
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
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
