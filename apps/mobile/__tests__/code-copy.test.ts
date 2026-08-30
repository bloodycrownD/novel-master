/**
 * T-CB19~T-CB23：copyCode 链路契约测试（cr-fix MF-12）。
 * Jest 为 RN 环境（无 jsdom），照 mermaid-fullscreen 样板走
 * 「读源码 + dist」契约测试，不改实现代码。
 *
 * 分级（tests/G-3）：web 源（shared/code-copy.ts、bind、main）属 webview 脚本
 * 文本类，保留；T-CB22 RN 双宿主断的是 WebView onMessage → Clipboard 的跨边界
 * 接线，行为化需要真 WebView 发消息，TestRenderer 无法触达，按脚本接线契约
 * 保留源码断言。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readWebViewDistFile} from './helpers/read-webview-dist';

const webSrc = (rel: string) =>
  readFileSync(join(__dirname, '../src/web', rel), 'utf8');

const rnSrc = (rel: string) =>
  readFileSync(join(__dirname, '../src', rel), 'utf8');

describe('copyCode 共享委托模块源码契约 (T-CB19)', () => {
  it('document 捕获阶段 click 委托 + closest 命中 + stopPropagation 拦截冒泡', () => {
    const src = webSrc('shared/code-copy.ts');
    // 监听挂 document：innerHTML 整段替换不丢；捕获阶段先于 rows 等冒泡委托
    expect(src).toMatch(/document\.addEventListener\(\s*'click'/);
    expect(src).toMatch(/,\s*true,?\s*\n\s*\);/);
    // 委托命中：点击点向上找 span.code-copy 按钮
    expect(src).toContain("target.closest('.code-copy')");
    // 命中后立刻拦断冒泡，防「复制 + 折叠」双触发
    expect(src).toContain('event.stopPropagation()');
  });

  it('textContent 收集进 copyCode 负载；copied 态 1500ms 复位；attached 幂等守卫 (T-CB20)', () => {
    const src = webSrc('shared/code-copy.ts');
    // pre 内 code 的 textContent 作为负载上抛 RN 原生 Clipboard
    expect(src).toContain("btn.closest('pre')?.querySelector('code')");
    expect(src).toContain("post('copyCode', {code: text})");
    // 复制成功反馈：加 copied 态、定时移除
    expect(src).toContain("btn.classList.add('copied')");
    expect(src).toContain("btn.classList.remove('copied')");
    expect(src).toContain('COPY_FEEDBACK_MS = 1500');
    expect(src).toMatch(/window\.setTimeout\(\s*\(\) => btn\.classList\.remove\('copied'\)/);
    // 幂等：重复挂接只挂一次，不叠加 document 监听
    expect(src).toMatch(/if \(attached \|\| typeof document === 'undefined'\)/);
    expect(src).toContain('attached = true;');
  });
});

describe('copyCode dist 产物契约 (T-CB21)', () => {
  it('两包 app.js 均含 code-copy 委托标记（模块确实进了 bundle）', () => {
    for (const pkg of ['chat-transcript', 'rich-document'] as const) {
      const appJs = readWebViewDistFile(pkg, 'app.js');
      expect(appJs).toContain('.code-copy');
      expect(appJs).toContain('copyCode');
    }
  });
});

describe('copyCode 双宿主 RN 源码契约 (T-CB22)', () => {
  it('两宿主 handleMessage 含 copyCode 分支且落 Clipboard.setString；两 bridge 含消息类型', () => {
    const chat = rnSrc('components/chat/ChatTranscriptWebView.tsx');
    const rich = rnSrc('components/vfs/RichDocumentWebView.tsx');
    // handleMessage 分支：decode 后判 copyCode，非空 code 落原生剪贴板
    for (const host of [chat, rich]) {
      expect(host).toContain("message.type === 'copyCode'");
      expect(host).toContain("String(message.payload.code ?? '')");
      expect(host).toContain('if (code) {');
      expect(host).toContain('Clipboard.setString(code)');
      expect(host).toContain("from '@react-native-clipboard/clipboard'");
    }
    // 桥消息类型定义：webview 侧 post 的 copyCode 在类型联合里有登记
    expect(rnSrc('components/chat/ChatTranscriptBridge.ts')).toContain(
      "BridgeEnvelope<'copyCode'",
    );
    expect(rnSrc('components/vfs/RichDocumentBridge.ts')).toContain(
      "BridgeEnvelope<'copyCode'",
    );
  });
});

describe('copyCode 两管线挂接契约 (T-CB23)', () => {
  it('chat-transcript bind-shell-events 与 rich-document main 均挂接 attachCodeCopyDelegation', () => {
    const bind = webSrc(
      'chat-transcript/webview/runtime/boot/bind-shell-events.ts',
    );
    // chat：壳级绑定处挂接，传 bridge 的 post（空白容忍，锁语义 token）
    expect(bind).toMatch(
      /import\s*\{\s*attachCodeCopyDelegation\s*\}\s*from\s*'@web\/shared\/code-copy'/,
    );
    expect(bind).toContain('attachCodeCopyDelegation(post)');

    // rich：模块初始化处挂接，不进 setDocument 视图刷新链路
    const main = webSrc('rich-document/webview/main.ts');
    expect(main).toMatch(
      /import\s*\{\s*attachCodeCopyDelegation\s*\}\s*from\s*'@web\/shared\/code-copy'/,
    );
    expect(main).toContain('attachCodeCopyDelegation(post)');
  });
});
