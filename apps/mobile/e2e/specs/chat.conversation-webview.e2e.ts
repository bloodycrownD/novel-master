import {switchToConversationWebView} from '../helpers/context';
import {appPage} from '../pageobjects/app.page';
import {chatTranscriptPage} from '../pageobjects/chat-transcript.page';

/**
 * T-CU12 e2e 冒烟：合成包单 context + web 内发送 + 输入断言。
 *
 * 断言三件事：
 * 1. **单 context 判据**：切进对话页 WebView 后，转录区（`#scroller`）与 composer dock
 *    （`#composer-dock` + textarea + 发送钮）在**同一个文档**里同时可见——这正是
 *    `ChatComposer`/`MessageList` 退役后「双 WebView」不再成立的证据；
 * 2. **输入断言**：写进 textarea 的文本能原样读回（web 是输入真源，RN 不再回写）；
 * 3. **web 内发送**：点 dock 的 `composer-send` 之后转录区出现用户消息——发送链路全程
 *    不切 NATIVE。
 *
 * 前置：设备上要有一个已保存的工作区模型（`launchFresh` 里的 `ensureWorkspaceModel`
 * 找不到会直接抛错并说明怎么补）。UI 自建项目 → after UI 自清。
 */
describe('T-CU12 conversation webview smoke', () => {
  let projectName = '';

  before(async () => {
    projectName = await appPage.launchFresh('E2E Conversation WV');
  });

  after(async () => {
    if (projectName === '') {
      return;
    }
    await appPage.deleteProjectViaDrawer(projectName);
  });

  it('transcript + composer dock live in one web document', async () => {
    await switchToConversationWebView();

    const inOneDocument = await browser.execute(() => {
      return (
        document.querySelector('#scroller') != null &&
        document.querySelector('#composer-dock') != null &&
        document.querySelector('textarea[data-testid="composer-input"]') != null &&
        document.querySelector('[data-testid="composer-send"]') != null
      );
    });
    expect(inOneDocument).toBe(true);
  });

  it('round-trips composer text inside the web document', async () => {
    const text = 'e2e-cu12-input-roundtrip';
    await chatTranscriptPage.setComposerText(text);
    await chatTranscriptPage.expectComposerText(text);
  });

  it('sends from the web dock without leaving the web context', async () => {
    // 三个 it 共享同一个 WebView 上下文、彼此不重置，发送前先记基线行数：
    // 只断言「转录区非空」（`>= 1`）会被**初始快照行**满足，等于没验证发送——
    // composer-send 即使 no-op 也照样绿（r6-G1）。改成「发送后比发送前多」才有牙齿，
    // 且不依赖文案形态（没配真实模型时宿主可能走「无模型降级」，行的角色/内容不稳定，
    // 但**行数必然 +1**）。
    const before = await chatTranscriptPage.countMessages();
    await chatTranscriptPage.sendComposerMessage('e2e-cu12-send');
    const after = await chatTranscriptPage.countMessages();
    expect(after).toBeGreaterThan(before);
  });
});