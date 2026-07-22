import {switchToNative, switchToWebView} from '../helpers/context';
import {withRetry} from '../helpers/retry';

/** WebView chat transcript: messages, context menu, rollback. */
export class ChatTranscriptPage {
  async openWebView(): Promise<void> {
    await switchToWebView();
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

  async sendComposerMessage(text: string): Promise<void> {
    await switchToNative();
    const input = await $('~chat-composer-input');
    await input.waitForDisplayed({timeout: 10000});
    await input.setValue(text);
    const send = await $('~发送');
    await send.click();
    await browser.pause(1200);
  }

  async setComposerText(text: string): Promise<void> {
    await switchToNative();
    const input = await $('~chat-composer-input');
    await input.waitForDisplayed({timeout: 10000});
    await input.setValue(text);
    await browser.pause(300);
  }

  async getComposerText(): Promise<string> {
    await switchToNative();
    const input = await $('~chat-composer-input');
    await input.waitForDisplayed({timeout: 10000});
    return input.getText();
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
}

export const chatTranscriptPage = new ChatTranscriptPage();
