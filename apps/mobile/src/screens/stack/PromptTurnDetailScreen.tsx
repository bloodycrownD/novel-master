/**
 * 提示词「轮详情」页（R4）：把一个 assistant 轮的正文（各段按序拼接、
 * 段前带角色前缀行）整段铺开阅读，可长按复制。
 *
 * - 纯预览态：无保存/编辑切换，`EditorScreenShell` 只渲染 preview slot
 *   （`editor` 是必填 prop，纯预览态传 null）。
 * - 渲染档位固定 `txt`：轮正文不是文档而是带 `[段名]` 前缀行的提示词原文，
 *   走 plain 分支即 `<Text selectable monospace>`，满足「可复制」验收；
 *   content 纯内存，不碰 VFS（照 PromptEditorScreen 的先例）。
 * - 正文不走路由参数（可达数百 KB）：挂载时从 prompt-turn-callback 模块级
 *   存取读走，读后即清。路由只带一个可序列化的短标题用于 header 覆盖。
 * - 不做二级折叠（v1 简化）。
 */
import React, {useEffect, useRef} from 'react';
import {useRoute, type RouteProp} from '@react-navigation/native';
import type {RootStackParamList} from '@/navigation/types';
import {useStackOverrideSetter} from '@/navigation/HeaderContext';
import {EditorScreenShell} from '@/components/chrome/EditorScreenShell';
import {FileMarkdownPreview} from '@/components/vfs/FileMarkdownPreview';
import {
  takePromptTurnDetail,
  type PromptTurnDetail,
} from '@/components/prompt/prompt-turn-callback';
import {useTheme} from '@/theme/ThemeProvider';

/** 伪路径以 .txt 结尾：正文按纯文本渲染，不进 markdown 管线。 */
const PROMPT_TURN_DETAIL_PATH = 'prompt.txt';

type PromptTurnDetailRoute = RouteProp<RootStackParamList, 'PromptTurnDetail'>;

export function PromptTurnDetailScreen() {
  const {tokens} = useTheme();
  const route = useRoute<PromptTurnDetailRoute>();
  const title = route.params?.title;
  // 屏级 override：自动带 ownerRouteKey，转场期间不泄漏到相邻屏 header。
  const setStackOverride = useStackOverrideSetter();
  // 挂载时消费一次（useRef 初值只跑一次）：读后即清，未消费即离开则丢弃。
  const detailRef = useRef<PromptTurnDetail | null>(takePromptTurnDetail());
  const body = detailRef.current?.body ?? '';

  useEffect(() => {
    if (!title) {
      return;
    }
    setStackOverride({title});
    return () => setStackOverride(undefined);
  }, [title, setStackOverride]);

  return (
    <EditorScreenShell
      tokens={tokens}
      toolbarBorderColor={tokens.borderLight}
      previewMode
      preview={
        <FileMarkdownPreview
          path={PROMPT_TURN_DETAIL_PATH}
          content={body}
          tokens={tokens}
          previewFill
          renderKind="txt"
        />
      }
      editor={null}
    />
  );
}