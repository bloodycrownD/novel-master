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

  /** Full UI seed: project → session → conversation chat panel. */
  async launchFresh(projectName = 'E2E Project'): Promise<void> {
    await this.ensureProject(projectName);
    await this.createSession();
    await this.openLatestSession();
    await this.switchToChatPanel();
  }
}

export const appPage = new AppPage();
