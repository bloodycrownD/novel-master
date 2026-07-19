import {switchToNative} from '../helpers/context';

/** App shell: project/session bootstrap and tab navigation. */
export class AppPage {
  /** Wait until chat tab chrome is ready after cold start. */
  async waitForLaunch(): Promise<void> {
    await switchToNative();
    const chatTab = await $('~对话');
    await chatTab.waitForDisplayed({timeout: 60000});
  }

  async openProjectDrawer(): Promise<void> {
    await switchToNative();
    const menu = await $('~项目列表');
    await menu.waitForDisplayed({timeout: 10000});
    await menu.click();
  }

  async closeProjectDrawerIfOpen(): Promise<void> {
    const close = await $('~关闭项目列表');
    if (await close.isExisting()) {
      await close.click();
    }
  }

  async createProject(name: string): Promise<void> {
    await this.openProjectDrawer();
    const createBtn = await $('android=new UiSelector().text("新建")');
    await createBtn.waitForDisplayed({timeout: 10000});
    await createBtn.click();
    const input = await $('~text-prompt-input');
    await input.waitForDisplayed({timeout: 5000});
    await input.setValue(name);
    const submit = await $('~text-prompt-submit');
    await submit.click();
    const created = await $(`android=new UiSelector().text("${name}")`);
    await created.waitForDisplayed({timeout: 10000});
    await created.click();
    await this.closeProjectDrawerIfOpen();
  }

  async ensureProject(name = 'E2E Project'): Promise<void> {
    await this.waitForLaunch();
    await this.openProjectDrawer();
    const existing = await $(`android=new UiSelector().text("${name}")`);
    if (await existing.isExisting()) {
      await existing.click();
      await this.closeProjectDrawerIfOpen();
      return;
    }
    await this.closeProjectDrawerIfOpen();
    await this.createProject(name);
  }

  async createSession(): Promise<void> {
    await switchToNative();
    const createSession = await $('android=new UiSelector().text("新建会话")');
    await createSession.waitForDisplayed({timeout: 10000});
    await createSession.click();
    await browser.pause(800);
  }

  async openLatestSession(): Promise<void> {
    await switchToNative();
    const sessionTitle = await $(
      'android=new UiSelector().textMatches("会话.*")',
    );
    await sessionTitle.waitForDisplayed({timeout: 10000});
    await sessionTitle.click();
    const chatTab = await $('~tab-chat');
    await chatTab.waitForDisplayed({timeout: 15000});
  }

  async switchToChatPanel(): Promise<void> {
    await switchToNative();
    const tab = await $('~tab-chat');
    await tab.waitForDisplayed({timeout: 10000});
    await tab.click();
  }

  async switchToWorkspacePanel(): Promise<void> {
    await switchToNative();
    const tab = await $('~tab-workspace');
    await tab.waitForDisplayed({timeout: 10000});
    await tab.click();
  }

  async switchToProfilePanel(): Promise<void> {
    await switchToNative();
    const tab = await $('~我的');
    await tab.waitForDisplayed({timeout: 10000});
    await tab.click();
  }

  /**
   * 对话态会隐藏 MainTabs：若「我的」不可见，先回会话列表再继续依赖底栏的流程。
   */
  async leaveConversationIfNeeded(): Promise<void> {
    await switchToNative();
    const profileTab = await $('~我的');
    if (await profileTab.isDisplayed()) {
      return;
    }
    const backBtn = await $('~返回');
    if (await backBtn.isExisting()) {
      await backBtn.click();
    } else {
      await driver.back();
    }
    await profileTab.waitForDisplayed({timeout: 10000});
  }

  /**
   * Ensure a workspace model is selected so ChatComposer hasModel is true.
   * Opens the in-chat or profile model picker and selects the first saved model.
   */
  async ensureWorkspaceModel(): Promise<void> {
    await switchToNative();
    await this.switchToChatPanel();

    const needModelHint = await $(
      'android=new UiSelector().text("请先选择工作区模型")',
    );
    if (await needModelHint.isExisting()) {
      await needModelHint.click();
      await this.selectFirstWorkspaceModel();
      return;
    }

    const input = await $('~chat-composer-input');
    if (await input.isExisting()) {
      const enabled = await input.isEnabled();
      if (enabled) {
        return;
      }
    }

    // 对话态底栏隐藏，不可点「我的」：先回列表
    await this.leaveConversationIfNeeded();
    await this.switchToProfilePanel();
    const modelMenu = await $('android=new UiSelector().text("当前大模型")');
    await modelMenu.waitForDisplayed({timeout: 10000});
    await modelMenu.click();
    await this.selectFirstWorkspaceModel();

    const chatMainTab = await $('~对话');
    await chatMainTab.waitForDisplayed({timeout: 10000});
    await chatMainTab.click();

    const tabChat = await $('~tab-chat');
    if (!(await tabChat.isExisting())) {
      await this.openLatestSession();
    }
    await this.switchToChatPanel();
  }

  private async selectFirstWorkspaceModel(): Promise<void> {
    await switchToNative();
    const title = await $('android=new UiSelector().text("选择工作区模型")');
    await title.waitForDisplayed({timeout: 10000});

    const empty = await $('android=new UiSelector().textContains("暂无已保存模型")');
    if (await empty.isExisting()) {
      throw new Error(
        '[e2e] No saved workspace models. Run e2e/scripts/inject-tool-turn-fixture ' +
          'or add a model via Profile → 服务商 before chat specs.',
      );
    }

    const rows = await $$(
      'android=new UiSelector().className("android.view.ViewGroup")',
    );
    for (const row of rows) {
      const textViews = await row.$$(
        'android=new UiSelector().className("android.widget.TextView")',
      );
      for (const tv of textViews) {
        const label = await tv.getText();
        if (
          label &&
          label !== '选择工作区模型' &&
          label !== '取消' &&
          label !== '当前' &&
          !label.includes('暂无已保存模型')
        ) {
          await row.click();
          await browser.pause(400);
          return;
        }
      }
    }

    throw new Error('[e2e] Model picker opened but no selectable model row found.');
  }

  /** Full UI seed: project → session → conversation chat panel. */
  async launchFresh(projectName = 'E2E Project'): Promise<void> {
    await this.ensureProject(projectName);
    await this.createSession();
    await this.openLatestSession();
    await this.switchToChatPanel();
    await this.ensureWorkspaceModel();
  }
}

export const appPage = new AppPage();
