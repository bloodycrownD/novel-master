/**
 * T-SP22：transcript 4 key 的 i18n 契约与宿主下发 parity。
 *
 * - core `LABEL_KEY_DOMAINS` 含 `transcript`，`LABEL_MESSAGE_KEYS` / zh-CN /
 *   en-US catalog 都含 4 个 `label.transcript.*`（域校验 blocking，key 缺失
 *   由 catalog.test / parse-core-catalog.test 兜底）；
 * - `TranscriptLabelsFactory.build(coreT)` 的取值与 web 缺省 `DEFAULT_LABELS` 一致——
 *   `init.labels` 下发与旧宿主兜底不会静默漂移；
 * - 宿主 `init` 确实带 `labels: TranscriptLabelsFactory.build(coreT)`；
 * - `RowList` / `StreamingMessageRow` / `ToolInvokingBar` 的源文件不再出现
 *   四个文案字面量（文件级原文扫描，注释也计入）。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  CORE_CATALOGS,
  CORE_MESSAGE_KEYS,
  LABEL_KEY_DOMAINS,
} from '@novel-master/core/i18n';
import {TranscriptLabelsFactory} from '../src/components/chat/transcript-labels'
import {coreT} from '../src/i18n/core';
import {DEFAULT_LABELS, DEFAULT_UI_LABELS, Labels} from '../src/web/chat-transcript/webview/ui/labels';

const TRANSCRIPT_KEYS = [
  'label.transcript.generating',
  'label.transcript.thinking_header',
  'label.transcript.empty',
  'label.transcript.load_older',
];

/** 四个用户可见文案（zh-CN）：册值 + 硬编码残留扫描共用。 */
const ZH_VALUES = ['生成中', '思考过程', '暂无消息', '加载更早消息'];

/** 四个 key 的 en-US 定稿值（同步英文目录）。 */
const EN_VALUES: Record<string, string> = {
  'label.transcript.generating': 'Generating',
  'label.transcript.thinking_header': 'Thinking',
  'label.transcript.empty': 'No messages yet',
  'label.transcript.load_older': 'Load earlier messages',
};

/** 硬编码扫描面：三个渲染组件按 T-SP22 做文件级原文扫描（注释也计入）。 */
const RENDER_FILES = [
  '../src/web/chat-transcript/webview/ui/render/RowList.tsx',
  '../src/web/chat-transcript/webview/ui/stream/StreamingMessageRow.tsx',
  '../src/web/chat-transcript/webview/ui/render/ToolInvokingBar.tsx',
];

/** 源文件原文，不剥注释：T-SP22 口径是文件级扫描。 */
function readSource(relPath: string): string {
  return readFileSync(join(__dirname, relPath), 'utf8');
}

describe('transcript 4 key 的 core i18n 契约', () => {
  it('LABEL_KEY_DOMAINS 含 transcript（10 域）', () => {
    expect(LABEL_KEY_DOMAINS).toContain('transcript');
  });

  it('4 个 key 在 CORE_MESSAGE_KEYS 与 zh-CN/en-US catalog 中都存在', () => {
    for (const key of TRANSCRIPT_KEYS) {
      expect(CORE_MESSAGE_KEYS).toContain(key);
      expect(CORE_CATALOGS['zh-CN'][key]).toBeTruthy();
      expect(CORE_CATALOGS['en-US'][key]).toBe(EN_VALUES[key]);
    }
  });
});

describe('宿主 labels 装配（T-SP22）', () => {
  it('TranscriptLabelsFactory.build(coreT) 取到 4 个中文文案', () => {
    expect(TranscriptLabelsFactory.build(coreT)).toEqual({
      generating: ZH_VALUES[0],
      thinking: ZH_VALUES[1],
      empty: ZH_VALUES[2],
      loadOlder: ZH_VALUES[3],
      ui: DEFAULT_UI_LABELS,
    });
  });

  it('web 缺省 DEFAULT_LABELS 与 core catalog 逐字段一致（无漂移）', () => {
    expect(DEFAULT_LABELS).toEqual(TranscriptLabelsFactory.build(coreT));
  });

  it('build(coreT) 的 ui map 与 zh-CN catalog 逐键一致（p27 R6 ui 域桥）', () => {
    const zh = CORE_CATALOGS['zh-CN']!;
    const built = TranscriptLabelsFactory.build(coreT);
    const uiKeys = Object.keys(built.ui);
    expect(uiKeys.length).toBeGreaterThan(0);
    for (const key of uiKeys) {
      // 波 3-1 起桥随发共享 portal 的 ui.common.close，键域不再限于 transcript 段。
      expect(key).toMatch(/^ui\./);
      expect(built.ui[key]).toBe(zh[key]);
    }
  });

  it('ChatConversationWebView 的 init 带 labels: TranscriptLabelsFactory.build(coreT)', () => {
    const host = readSource(
      '../src/components/chat/ChatConversationWebView.tsx',
    );
    expect(host).toContain('labels: TranscriptLabelsFactory.build(coreT)');
  });
});

describe('web 缺省回退 resolveLabels（C30）', () => {
  it('undefined / null / 非对象 → 四键全量默认', () => {
    expect(Labels.resolve(undefined)).toEqual(DEFAULT_LABELS);
    expect(Labels.resolve(null)).toEqual(DEFAULT_LABELS);
    expect(Labels.resolve('not-an-object')).toEqual(DEFAULT_LABELS);
  });

  it('缺键 / 空串 / 非字符串逐键回退默认，其余合法键原样保留', () => {
    expect(
      Labels.resolve({
        generating: '自定义生成文案',
        thinking: '',
        empty: 42,
        loadOlder: null,
      }),
    ).toEqual({
      generating: '自定义生成文案',
      thinking: DEFAULT_LABELS.thinking,
      empty: DEFAULT_LABELS.empty,
      loadOlder: DEFAULT_LABELS.loadOlder,
      ui: DEFAULT_UI_LABELS,
    });
  });

  it('合法四键原样透传，未知字段忽略', () => {
    expect(
      Labels.resolve({
        generating: 'G',
        thinking: 'T',
        empty: 'E',
        loadOlder: 'L',
        extra: 'ignored',
      }),
    ).toEqual({
      generating: 'G',
      thinking: 'T',
      empty: 'E',
      loadOlder: 'L',
      ui: DEFAULT_UI_LABELS,
    });
  });
});

describe('ui.* 域桥（p27 R6 第 0 片）', () => {
  it('ui map 逐键覆盖缺省；空串 / 非字符串回退 DEFAULT_UI_LABELS', () => {
    const key = 'ui.transcript.menu.edit';
    expect(Labels.resolve({ui: {[key]: '自定义编辑'}}).ui[key]).toBe('自定义编辑');
    expect(Labels.resolve({ui: {[key]: ''}}).ui[key]).toBe(DEFAULT_UI_LABELS[key]);
    expect(Labels.resolve({ui: {[key]: 42}}).ui[key]).toBe(DEFAULT_UI_LABELS[key]);
  });

  it('ui 缺省 / 非对象 → 全量 DEFAULT_UI_LABELS 兜底', () => {
    expect(Labels.resolve({}).ui).toEqual(DEFAULT_UI_LABELS);
    expect(Labels.resolve({ui: 'not-an-object'}).ui).toEqual(DEFAULT_UI_LABELS);
    expect(Labels.resolve({ui: [1, 2]}).ui).toEqual(DEFAULT_UI_LABELS);
  });
});

describe('渲染组件不硬编码四个文案（读 state.labels / prop）', () => {
  for (const relPath of RENDER_FILES) {
    it(`${relPath} 的源文件不含四个字面量`, () => {
      const code = readSource(relPath);
      for (const literal of ZH_VALUES) {
        expect(code).not.toContain(literal);
      }
    });
  }
});
