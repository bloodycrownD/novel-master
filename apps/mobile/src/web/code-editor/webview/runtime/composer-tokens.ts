/**
 * composer-token 胶囊高亮（CodeMirror 6 扩展，chat 输入框全屏专用）。
 *
 * `@路径` / `$技能名` 区间复用 chat 链的 `composerTokenRanges`——与内联输入框
 * （composer-input 包）同一正则口径，两侧胶囊的成段/不成段行为天然一致；
 * mark 装饰挂 `.cm-composer-token`（样式见 styles/editor.css，与内联
 * `.composer-input__token` 同款：muted 底 + primary 字 + 负 margin 抵消 padding）。
 *
 * 连锁删除走 CM 原生 `EditorView.atomicRanges`：同一份区间既是高亮也是原子
 * 区间——退格/删除整段摘除、方向键跳过，语义对齐内联输入框的
 * tryAtomicRangeDelete（删除窗碰到区间且未盖满即整段删）。
 *
 * 只在 composer 伪路径下挂载：文件编辑（prompt.md 等真/伪文件）里 `$xx`
 * 是普通文本，不该被胶囊化。
 */
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {composerTokenRanges} from '@/components/chat/composer-highlight';

/**
 * composer 变体伪路径：激活胶囊扩展（语言仍按 .md → markdown 高亮）。
 * RN 侧 `PromptEditorScreen.COMPOSER_EDITOR_PATH` 是同值镜像，改这里必须同步。
 */
export const COMPOSER_TOKEN_PATH = 'composer.md';

const tokenMark = Decoration.mark({class: 'cm-composer-token'});

function buildTokenDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const ranges = composerTokenRanges(text);
  if (ranges.length === 0) {
    return Decoration.none;
  }
  // composerTokenRanges 保证按序不重叠；sort 参数兜底防御
  return Decoration.set(
    ranges.map(range => tokenMark.range(range.start, range.end)),
    true,
  );
}

export const composerTokenHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildTokenDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildTokenDecorations(update.view);
      }
    }
  },
  {
    decorations: value => value.decorations,
    provide: plugin =>
      EditorView.atomicRanges.of(
        view => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
  },
);

/** 路径是否挂 composer-token 胶囊扩展（伪路径判定）。 */
export function composerTokenEnabled(path: string): boolean {
  return path === COMPOSER_TOKEN_PATH;
}
