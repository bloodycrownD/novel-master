import {switchToConversationWebView} from '../helpers/context';
import {withRetry} from '../helpers/retry';

/**
 * composer 输入框：合成包 `#composer-input` 挂点下 runtime 装的 textarea
 * （`web/composer-input/webview/runtime/editor.ts` 自带 `data-testid="composer-input"`）。
 */
const COMPOSER_TEXTAREA = 'textarea[data-testid="composer-input"]';

/**
 * dock toolbar 的发送/终止钮：dock 侧 `buildToolbar()` 装配
 * （`web/chat-conversation/webview/dock.ts`），点击上行 `dockAction`。
 *
 * chat-webview-unify 之前发送键是 RN 原生工具栏按钮（`~发送`），现在进了 web，
 * 点它必须待在对话页 WEBVIEW context 里——**不要**切 NATIVE。
 */
const DOCK_SEND_BUTTON = '[data-testid="composer-send"]';

/** dock 的「请先选择工作区模型」提示行（`#composer-hint-row`，显隐判据是 `!hasModel`）。 */
const DOCK_HINT_ROW = '[data-testid="composer-hint-row"]';

/** WebView chat transcript: messages, context menu, rollback, composer dock. */
export class ChatTranscriptPage {
  /**
   * 切到对话页 WebView。
   *
   * 转录区与 composer dock 已在合成包里合流成同一个文档，所以「切到转录」和
   * 「切到输入框」是同一件事；判据（`#composer-dock` 等）在 helper 里做。
   */
  async openWebView(): Promise<void> {
    await switchToConversationWebView();
  }

  async waitForMessage(messageId: string): Promise<void> {
    await this.openWebView();
    const row = await $(`.row.message[data-id="${messageId}"]`);
    await row.waitForExist({timeout: 20000});
  }

  async countMessages(): Promise<number> {
    await this.openWebView();
    const rows = await $$('.row.message');
    return rows.length;
  }

  async getMessageIds(): Promise<string[]> {
    await this.openWebView();
    return browser.execute(() => {
      // 只数 user 行：宿主发送链路在无真模型环境下每条用户消息可能伴生一条
      // 降级/错误回复入流（模拟器实测「发 3 得 5-6」）——rollback 场景锚定的
      // 就是用户消息，按角色过滤后断言才与环境解耦（2026-10-01 e2e 实跑）。
      return Array.from(document.querySelectorAll('.row.message.user'))
        .map(el => el.getAttribute('data-id'))
        .filter((id): id is string => id != null && id !== '');
    });
  }

  /**
   * 不过滤角色的全量消息 id（含 assistant）。
   *
   * T-E2（assistant rewind）的锚点与断言对象是 assistant 消息——走 user
   * 过滤入口必拿不到，须用本入口；其余「锚定用户消息」的用例继续用
   * getMessageIds（cr2-D-1）。
   */
  async getAllMessageIds(): Promise<string[]> {
    await this.openWebView();
    return browser.execute(() => {
      return Array.from(document.querySelectorAll('.row.message'))
        .map(el => el.getAttribute('data-id'))
        .filter((id): id is string => id != null && id !== '');
    });
  }

  async scrollTranscriptUp(pixels = 400): Promise<void> {
    await this.openWebView();
    await browser.execute((dy: number) => {
      const scroller = document.getElementById('scroller');
      if (scroller != null) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - dy);
      }
    }, pixels);
    await browser.pause(300);
  }

  async openMessageMenu(messageId: string): Promise<void> {
    await withRetry(
      async () => {
        await this.openWebView();
        const btn = await $(
          `.row.message[data-id="${messageId}"] .message-menu-btn`,
        );
        await btn.waitForExist({timeout: 15000});
        await btn.click();
        const menuProbe = await $('[data-menu-action="rollback"]');
        await menuProbe.waitForExist({timeout: 2500});
      },
      {attempts: 3, delayMs: 700, label: `openMessageMenu(${messageId})`},
    );
  }

  /** @deprecated 使用 {@link openMessageMenu}（⋯ 点击）；保留别名兼容旧规格。 */
  async longPressMessage(messageId: string): Promise<void> {
    await this.openMessageMenu(messageId);
  }

  async tapMenuAction(action: 'rollback' | 'edit' | 'delete'): Promise<void> {
    await this.openWebView();
    const btn = await $(`[data-menu-action="${action}"]`);
    await btn.waitForDisplayed({timeout: 5000});
    await btn.click();
  }

  /**
   * 写文本 + 点发送（发送键在 web 的 dock toolbar 里，全程待在对话页 context）。
   *
   * 旧实现是「先切 NATIVE 点 `~发送`」——那个原生按钮随 `ChatComposer` 一起退役了，
   * 现在必须在 web 里点 dock 的 `composer-send`。
   */
  async sendComposerMessage(text: string): Promise<void> {
    await this.setComposerText(text);
    await this.clickDockSendButton();
  }

  /** 点 dock toolbar 的发送钮（运行态下同一个钮是「终止」，aria-label 随之切换）。 */
  async clickDockSendButton(): Promise<void> {
    await withRetry(
      async () => {
        await this.openWebView();
        const send = await $(DOCK_SEND_BUTTON);
        await send.waitForDisplayed({timeout: 10000});
        const disabled = await send.getAttribute('disabled');
        if (disabled !== null) {
          throw new Error(
            `[e2e] 发送钮处于禁用态（sendDisabled=${disabled}）：多半是没选工作区模型或草稿为空`,
          );
        }
        await send.click();
      },
      {attempts: 3, delayMs: 700, label: 'clickDockSendButton'},
    );
    await browser.pause(1200);
  }

  async setComposerText(text: string): Promise<void> {
    await this.openWebView();
    const input = await $(COMPOSER_TEXTAREA);
    await input.waitForDisplayed({timeout: 10000});
    // 受控 textarea 坑：直接 `el.value = v` 不会触发 web 侧的 input 监听，
    // 「原子删拦截 → post('change')」整条链路都不跑，宿主永远收不到文本。
    // 必须走 native value setter + dispatch input 事件，模拟真实打字。
    const filled = await browser.execute(
      (selector: string, value: string) => {
        const el = document.querySelector<HTMLTextAreaElement>(selector);
        if (el == null) {
          return false;
        }
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        setter?.call(el, value);
        el.focus();
        el.dispatchEvent(new Event('input', {bubbles: true}));
        return true;
      },
      COMPOSER_TEXTAREA,
      text,
    );
    if (filled !== true) {
      throw new Error(`[e2e] composer textarea 写入失败：${COMPOSER_TEXTAREA}`);
    }
    await browser.pause(300);
  }

  async getComposerText(): Promise<string> {
    await this.openWebView();
    const input = await $(COMPOSER_TEXTAREA);
    await input.waitForDisplayed({timeout: 10000});
    const value = await browser.execute((selector: string) => {
      const el = document.querySelector<HTMLTextAreaElement>(selector);
      return el == null ? null : el.value;
    }, COMPOSER_TEXTAREA);
    if (typeof value !== 'string') {
      throw new Error(`[e2e] composer textarea 读取失败：${COMPOSER_TEXTAREA}`);
    }
    return value;
  }

  async expectComposerText(expected: string): Promise<void> {
    await withRetry(
      async () => {
        const text = await this.getComposerText();
        expect(text).toBe(expected);
      },
      {attempts: 3, delayMs: 700, label: `expectComposerText(${expected})`},
    );
  }

  /** DOM sibling order inside one assistant bubble: thinking → body → tools. */
  async assertAssistantBlockOrder(messageId: string): Promise<void> {
    await this.openWebView();
    const order = await browser.execute((id: string) => {
      const row = document.querySelector(
        '.row.message.assistant[data-id="' + id + '"]',
      );
      if (row == null) {
        return [] as string[];
      }
      const bubble = row.querySelector('.bubble');
      if (bubble == null) {
        return [] as string[];
      }
      const tags: string[] = [];
      for (const child of Array.from(bubble.children)) {
        if (child.classList.contains('thinking-section')) {
          tags.push('thinking');
        } else if (child.classList.contains('bubble-body')) {
          tags.push('body');
        } else if (child.classList.contains('tool-phase-bar')) {
          tags.push('phase');
        } else if (child.classList.contains('tool-group-section')) {
          tags.push('tools');
        }
      }
      return tags;
    }, messageId);

    expect(order.length).toBeGreaterThanOrEqual(3);
    expect(order.indexOf('thinking')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('body')).toBeGreaterThan(order.indexOf('thinking'));
    expect(order.indexOf('tools')).toBeGreaterThan(order.indexOf('body'));
  }

  async assertMessageHasToolGroup(messageId: string): Promise<void> {
    await this.openWebView();
    const hasTools = await browser.execute((id: string) => {
      const row = document.querySelector(
        '.row.message.assistant[data-id="' + id + '"]',
      );
      return row?.querySelector('.tool-group-section') != null;
    }, messageId);
    expect(hasTools).toBe(true);
  }

  async expectMessageMissing(messageId: string): Promise<void> {
    await this.openWebView();
    const row = await $(`.row.message[data-id="${messageId}"]`);
    expect(await row.isExisting()).toBe(false);
  }

  async expectToolPhaseBarVisible(visible: boolean): Promise<void> {
    await this.openWebView();
    const bar = await $('.tool-phase-bar');
    if (visible) {
      await bar.waitForDisplayed({timeout: 10000});
      const text = await bar.getText();
      expect(text).toContain('正在执行工具调用');
    } else {
      expect(await bar.isExisting()).toBe(false);
    }
  }

  async expectNoPendingToolSpinner(): Promise<void> {
    await this.openWebView();
    const pending = await $$('.tool-status.pending, .tool-pending-spinner');
    expect(pending.length).toBe(0);
  }

  /**
   * dock 的「请先选择工作区模型」提示行当前是否可见（web DOM 判据，RN 树里已不存在）。
   *
   * dock 用 `hidden` 属性控制显隐，`isExisting()` 分不出显示/隐藏，所以查
   * `hidden` 属性——这是它与普通 web 元素探测最大的差别。
   */
  async isDockHintRowVisible(): Promise<boolean> {
    try {
      await this.openWebView();
      const visible = await browser.execute((selector: string) => {
        const el = document.querySelector(selector);
        if (el == null) {
          return false;
        }
        return !el.hasAttribute('hidden');
      }, DOCK_HINT_ROW);
      return visible === true;
    } catch {
      // 对话页 WebView 还没起来（刚进会话的冷启动窗口）→ 当「没看到提示行」，
      // 让 `ensureWorkspaceModel` 继续走后面的探测分支，而不是把整个 spec 掀翻。
      return false;
    }
  }

  /** 点 dock 的「请先选择工作区模型」提示行 → 上行 `dockAction.needModel`，宿主开工作区模型选择器。 */
  async clickDockHintRow(): Promise<void> {
    await this.openWebView();
    const hint = await $(DOCK_HINT_ROW);
    await hint.waitForDisplayed({timeout: 10000});
    await hint.click();
    await browser.pause(400);
  }

  /** composer 输入框是否在 web 文档里（RN 容器上的 `chat-composer-input` testID 已退役）。 */
  async composerInputExists(): Promise<boolean> {
    try {
      await this.openWebView();
    } catch {
      // 还没进对话页（或对话页没挂载）→ 不算「存在」。
      return false;
    }
    const input = await $(COMPOSER_TEXTAREA);
    return input.isExisting();
  }
}

export const chatTranscriptPage = new ChatTranscriptPage();
