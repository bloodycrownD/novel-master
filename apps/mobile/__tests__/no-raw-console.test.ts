/**
 * 本轮改动文件「零裸 console」守卫（spec C31 / §7.3 二段式第 1 段）。
 *
 * 扫描面 = 本迭代 C1/C2/C4/C5/C6/C7/C8/C9/C10/C11/C12/C13/C14/C32 的原生
 * 生产文件（`src/web/**` 不在 E6 扫描面，见 §7.3；两个 log 守卫测试自身含
 * `console` 正则字样，不进扫描面）。日志统一走 core `createLogger`，
 * detail 只放 id/status/err，正文不进日志。
 * `src/web/.../runtime/render/snapshot.ts` 的 `console.error` 与 `main.ts` /
 * `ToolGroup.tsx` 同类（web bundle 无 logger 依赖，装配/诊断唯一出口），已在
 * spec §7.3 保留清单显式登记，因此不进下方 `CHANGED_FILES`。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

/** 本轮改动文件（相对 apps/mobile）；缺一个都会让扫描面缩水。 */
const CHANGED_FILES = [
  'src/components/chat/ChatConversationBridge.ts',
  'src/components/chat/ChatConversationWebView.tsx',
  'src/components/chat/ChatTranscriptBridge.ts',
  'src/components/chat/ChatTranscriptWebViewHandle.ts',
  'src/components/chat/message-blocks.ts',
  'src/components/chat/chat-conversation-update-plan.ts',
  'src/components/chat/transcript-stream-projection.ts',
  'src/components/chat/transcript-labels.ts',
  'src/services/session-stream-unit.ts',
  'src/services/session-stream-unit-manager.service.ts',
  'src/services/session-stream-webview-adapter.ts',
  'src/screens/tabs/chat-tab/ChatTabProvider.tsx',
  'src/screens/tabs/chat-tab/ChatConversationPanel.tsx',
  'src/screens/stack/SubagentSessionScreen.tsx',
];

/** 裸 console 调用（注释先行剥掉，避免文档里的示例命中）。 */
const RAW_CONSOLE = /console\.(log|info|warn|error|debug|trace)\s*\(/;

/** 只留代码行：整块注释与行注释都剥掉。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('本轮改动文件零裸 console（spec C31）', () => {
  for (const file of CHANGED_FILES) {
    it(`${file} 不含裸 console 调用`, () => {
      const source = readFileSync(join(__dirname, '..', file), 'utf8');
      expect(stripComments(source)).not.toMatch(RAW_CONSOLE);
    });
  }
});
