/**
 * 提示词「轮详情」页（R4）：把某一轮或某张叶子卡的正文整段铺开阅读，可长按复制。
 *
 * - 纯预览态：无保存/编辑切换，`EditorScreenShell` 只渲染 preview slot
 *   （`editor` 是必填 prop，纯预览态传 null）。
 * - 渲染档位固定 `rich`：正文按 markdown 富文本渲染（WebView 管线），超长自动降级
 *   plain；**不用 `.md` 扩展名 + `renderKind='rich'` 跳过 front-matter 拆分**——
 *   走文件路径档位时 `---` 开头的正文会被误当 YAML 拆掉。content 纯内存，不碰 VFS
 *   （照 PromptEditorScreen 的先例）。
 * - 正文不走路由参数（可达数百 KB）：挂载时从 prompt-turn-callback 模块级
 *   存取读走，读后即清。路由只带可序列化的短标题与轮 id。
 * - `path` 是稳定伪 key（`turn-<turnId>` / `turn-<turnId>-leaf-<leafId>`）：
 *   防御性——若将来详情页支持页内切换内容，key 让 WebView 重挂载；当前页是终态、
 *   挂载后不再换内容。内容在 VFS 里不存在，path 不作取数用。
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

/** 轮 id 缺失时的占位（route params 可选，不影响渲染）。 */
const UNKNOWN_TURN_ID = 'unknown';

type PromptTurnDetailRoute = RouteProp<RootStackParamList, 'PromptTurnDetail'>;

export function PromptTurnDetailScreen() {
  const {tokens} = useTheme();
  const route = useRoute<PromptTurnDetailRoute>();
  const title = route.params?.title;
  const turnId = route.params?.turnId ?? UNKNOWN_TURN_ID;
  // 屏级 override：自动带 ownerRouteKey，转场期间不泄漏到相邻屏 header。
  const setStackOverride = useStackOverrideSetter();
  // 挂载时消费一次（useRef 初值只跑一次）：读后即清，未消费即离开则丢弃。
  const detailRef = useRef<PromptTurnDetail | null>(takePromptTurnDetail());
  const body = detailRef.current?.body ?? '';
  const leafId = detailRef.current?.leafId;
  // 伪 path：整轮 / 叶子两种形态各自稳定。防御性——若将来详情页支持页内切换内容，
  // key 让 WebView 重挂载；当前页是终态、挂载后不再换内容。
  const path =
    leafId === undefined ? `turn-${turnId}` : `turn-${turnId}-leaf-${leafId}`;

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
          path={path}
          content={body}
          tokens={tokens}
          previewFill
          renderKind="rich"
        />
      }
      editor={null}
    />
  );
}