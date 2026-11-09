/**
 * T-SP22：transcript 4 key 的 i18n 契约与宿主下发 parity。
 *
 * - core `LABEL_KEY_DOMAINS` 含 `transcript`，`LABEL_MESSAGE_KEYS` / zh-CN /
 *   en-US catalog 都含 4 个 `label.transcript.*`（域校验 blocking，key 缺失
 *   由 catalog.test / parse-core-catalog.test 兜底）；
 * - `buildTranscriptLabels(coreT)` 的取值与 web 缺省 `DEFAULT_LABELS` 一致——
 *   `init.labels` 下发与旧宿主兜底不会静默漂移；
 * - 宿主 `init` 确实带 `labels: buildTranscriptLabels(coreT)`；
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
import {buildTranscriptLabels} from '../src/components/chat/transcript-labels';
import {coreT} from '../src/i18n/core';
import {
  DEFAULT_LABELS,
  resolveLabels,
} from '../src/web/chat-transcript/webview/ui/labels';

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
  it('buildTranscriptLabels(coreT) 取到 4 个中文文案', () => {
    expect(buildTranscriptLabels(coreT)).toEqual({
      generating: ZH_VALUES[0],
      thinking: ZH_VALUES[1],
      empty: ZH_VALUES[2],
      loadOlder: ZH_VALUES[3],
    });
  });

  it('web 缺省 DEFAULT_LABELS 与 core catalog 逐字段一致（无漂移）', () => {
    expect(DEFAULT_LABELS).toEqual(buildTranscriptLabels(coreT));
  });

  it('ChatConversationWebView 的 init 带 labels: buildTranscriptLabels(coreT)', () => {
    const host = readSource(
      '../src/components/chat/ChatConversationWebView.tsx',
    );
    expect(host).toContain('labels: buildTranscriptLabels(coreT)');
  });
});

describe('web 缺省回退 resolveLabels（C30）', () => {
  it('undefined / null / 非对象 → 四键全量默认', () => {
    expect(resolveLabels(undefined)).toEqual(DEFAULT_LABELS);
    expect(resolveLabels(null)).toEqual(DEFAULT_LABELS);
    expect(resolveLabels('not-an-object')).toEqual(DEFAULT_LABELS);
  });

  it('缺键 / 空串 / 非字符串逐键回退默认，其余合法键原样保留', () => {
    expect(
      resolveLabels({
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
    });
  });

  it('合法四键原样透传，未知字段忽略', () => {
    expect(
      resolveLabels({
        generating: 'G',
        thinking: 'T',
        empty: 'E',
        loadOlder: 'L',
        extra: 'ignored',
      }),
    ).toEqual({generating: 'G', thinking: 'T', empty: 'E', loadOlder: 'L'});
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
