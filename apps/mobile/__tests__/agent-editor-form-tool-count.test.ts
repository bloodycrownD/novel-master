import {readFileSync} from 'fs';
import {join} from 'path';

/**
 * T-AG5：AgentEditorForm 内置工具计数文案源码锁。
 *
 * 该提示文案是硬编码计数（catalog 改动不会自动同步这里），用源码正则
 * 锁住「10 个」与工具名单含 agent、curl，防止后续加内置工具时漏改。
 * 照 provider-detail-tabs.test.ts 的源码正则测试样式。
 */
const formPath = join(
  __dirname,
  '../src/components/agent/agent-editor/AgentEditorToolsSection.tsx',
);
const source = readFileSync(formPath, 'utf8');

describe('AgentEditorForm builtin tools hint (T-AG5)', () => {
  it('默认模式提示文案计 10 个且名单含 agent 与 curl', () => {
    expect(source).toMatch(/未配置时使用全部内置工具（10/);
    expect(source).toMatch(
      /个）：task、read、write、edit、fs、glob、grep、skill、agent、curl。/,
    );
  });

  it('不再残留 8 个的旧计数', () => {
    expect(source).not.toMatch(/全部内置工具（8/);
  });
});
