/**
 * T-U10：ChatTabProvider 无运行态静态守卫（Step 7 / PRD 结构验收）。
 *
 * Provider 是单元投影的订阅者：运行态（流式缓冲/中止状态机/生命周期/
 * 重进注入）由 SessionStreamUnitManager 的 per-session 单元承担，Provider
 * 源码不得再出现这些运行态标识——出现即意味着屏幕层重新长出了第二套
 * 运行态装配。守卫按 T-P7 的静态断言手法（读源文件字符串匹配，含注释
 * 中的提及——描述运行态应引用单元/投影词汇而非旧标识名）。
 *
 * 发送态纯计算词（canResumeWithoutInput/lastMessageIsPlainUserText）是
 * 基于消息面的推导、不订阅运行态，不在守卫词表内。
 */
import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, expect, it} from '@jest/globals';

const PROVIDER_PATH = join(
  __dirname,
  '../src/screens/tabs/chat-tab/ChatTabProvider.tsx',
);

/** 守卫词表：以 Step 6/7 实际清空的运行态标识为准。 */
const RUNTIME_STATE_TOKENS = [
  'uiRunning',
  'activeRunId',
  'streamingText',
  'streamingThinking',
  'sessionAgentRunning',
  'streamTailGenerating',
] as const;

describe('T-U10: ChatTabProvider 无运行态静态守卫', () => {
  const source = readFileSync(PROVIDER_PATH, 'utf8');

  it.each(RUNTIME_STATE_TOKENS)(
    'ChatTabProvider.tsx 源码不含运行态标识 %s',
    token => {
      expect(source).not.toMatch(new RegExp(`\\b${token}\\b`));
    },
  );

  it('守卫文件存在（防路径漂移导致空跑）', () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain('ChatTabProvider');
  });
});


// 中断现场解锁（首字前被杀 run 水合后 composer 不再锁死）：行为语义由
// deriveComposerSendState/集成测试覆盖，此处静态保证推导含 interrupted 分支
// （分支被误删时立即红灯，而非静默回到锁死）。
describe('中断现场解锁输入（静态守卫）', () => {
  const source = readFileSync(PROVIDER_PATH, 'utf8');

  it('composerSendState 推导含 interrupted 解锁分支', () => {
    expect(source).toContain("unitView?.status === 'interrupted'");
    expect(source).toContain('lastMessageIsPlainUserText: false');
  });
});
