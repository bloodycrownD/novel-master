import {switchToNative} from '../helpers/context';

/**
 * 首屏「版本检查」弹窗的关闭候选（「今日不再提醒」优先，避免误触「去下载」）。
 *
 * 为什么三重兜底：弹窗按钮**同时带 `resource-id` 与 `content-desc`**（实测 dump：
 * `resource-id="update-check-result-snooze"` + `content-desc="今日不再提醒"`），
 * 而 Appium 的 `~id`（accessibility id）在 Android 上优先按 content-desc 匹配——
 * 只写 testID 可能查不到，所以显式 `resourceId` 打头、文案收尾。
 */
const UPDATE_MODAL_DISMISS_SELECTORS = [
  'android=new UiSelector().resourceId("update-check-result-snooze")',
  '~update-check-result-snooze',
  'android=new UiSelector().text("今日不再提醒")',
  'android=new UiSelector().text("关闭")',
] as const;

/**
 * RN `testID` → 显式 `resourceId` 选择器。
 *
 * 为什么不能直接用 `~testID`：本机 Appium/UiAutomator2 的 `accessibility id` 只按
 * **`content-desc`** 匹配，而 RN 的 `testID` 落到的是 **`resource-id`**、且这些元素
 * 没有 `content-desc`（实测 dump：输入框 `id=text-prompt-input`、`desc=` 空）。
 * 凡页对象里拿 `testID` 定位的地方，都要走这个助手。
 */
const byTestId = (testId: string): string =>
  `android=new UiSelector().resourceId("${testId}")`;

/** App shell: project/session bootstrap and tab navigation. */
export class AppPage {
  /**
   * 若「版本检查」弹窗开着就点掉，返回是否点掉了。
   *
   * 背景：该弹窗是**原生 `Modal`**，会另开窗口并**抢走整棵 a11y 树**——此后
   * `~对话` / `~项目列表` 一律查不到，spec 的 `before all` 必然挂。检查失败
   * （模拟器/CI 无外网）与成功（「当前已是最新版本」）**都会弹**，且每条 spec
   * 都重装应用、24h snooze 存不住，所以页对象层必须每次兜底。
   */
  async dismissUpdateCheckModalOnce(): Promise<boolean> {
    await switchToNative();
    for (const selector of UPDATE_MODAL_DISMISS_SELECTORS) {
      const button = await $(selector);
      if (await button.isExisting()) {
        await button.click();
        await browser.pause(400);
        return true;
      }
    }
    return false;
  }

  /** 在 `waitMs` 窗口内轮询弹窗并点掉；返回是否点掉了。 */
  async dismissUpdateCheckModalIfPresent(waitMs = 0): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    do {
      if (await this.dismissUpdateCheckModalOnce()) {
        return true;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await browser.pause(1000);
    } while (Date.now() < deadline);
    return false;
  }

  /**
   * Wait until chat tab chrome is ready after cold start.
   *
   * 弹窗与主界面的先后顺序不确定（实测主界面约 20s、弹窗约 25s，但冷启动抖动大），
   * 所以这里做**单循环互查**：每一轮先尝试点掉弹窗、再看主界面，而不是「等主界面
   * → 再等弹窗」——后者会在弹窗先到时直接卡死在 `waitForDisplayed` 上。
   */
  async waitForLaunch(): Promise<void> {
    await switchToNative();
    const deadline = Date.now() + 90000;
    let chatVisible = false;
    while (Date.now() < deadline) {
      await this.dismissUpdateCheckModalOnce();
      const chatTab = await $('~对话');
      chatVisible = await chatTab
        .isDisplayed()
        .catch(() => false);
      if (chatVisible) {
        break;
      }
      await browser.pause(1000);
    }
    if (!chatVisible) {
      throw new Error(
        '[e2e] 主界面 90s 内未就绪（可能被「版本检查」弹窗或启动失败挡住）',
      );
    }
    // 收尾再探一次：弹窗可能刚好在主界面之后出现。
    await this.dismissUpdateCheckModalIfPresent(5000);
  }

  async openProjectDrawer(): Promise<void> {
    await switchToNative();
    const menu = await $('~项目列表');
    await menu.waitForDisplayed({timeout: 10000});
    await menu.click();
  }

  async closeProjectDrawerIfOpen(): Promise<void> {
    await switchToNative();
    // 抽屉关闭按钮的 a11y label 在 2026-08-30「components 大收敛」后由
    // 「关闭项目列表」换成了 `ModalShell` 的「关闭」——两个都试，避免页对象与实现
    // 脱节（main 上既有债；抽屉关不掉会让下一次 `openProjectDrawer` 必然失败）。
    for (const selector of ['~关闭项目列表', '~关闭']) {
      const close = await $(selector);
      if (await close.isExisting()) {
        await close.click();
        await browser.pause(300);
        return;
      }
    }
  }

  async createProject(name: string): Promise<void> {
    await this.openProjectDrawer();
    const createBtn = await $('android=new UiSelector().text("新建")');
    await createBtn.waitForDisplayed({timeout: 10000});
    await createBtn.click();
    // ⚠️ 等待放宽到 15s：模拟器（尤其冷启动后首个弹窗）里「新建项目」对话框
    // 出现明显晚于真机——原 5s 实测会偶发超时（对话框其实几秒后才渲染出来）。
    const input = await $(byTestId('text-prompt-input'));
    await input.waitForDisplayed({timeout: 15000});
    await input.setValue(name);
    const submit = await $(byTestId('text-prompt-submit'));
    await submit.click();
    const created = await $(`android=new UiSelector().text("${name}")`);
    await created.waitForDisplayed({timeout: 15000});
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
    const chatTab = await $(byTestId('tab-chat'));
    await chatTab.waitForDisplayed({timeout: 15000});
  }

  async switchToChatPanel(): Promise<void> {
    await switchToNative();
    const tab = await $(byTestId('tab-chat'));
    await tab.waitForDisplayed({timeout: 10000});
    await tab.click();
  }

  async switchToWorkspacePanel(): Promise<void> {
    await switchToNative();
    const tab = await $(byTestId('tab-workspace'));
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
   * Ensure a workspace model is selected so the composer dock's hasModel is true.
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

    // composer 输入探测：testID 现在落在 WebView 容器 View 上（更早先是原生
    // TextInput，壳一环接一环：ComposerAtPathInput → ComposerInputWebView）。
    // RN testID 仍落 resource-id，容器照样可探。
    //
    // 注记（变更 14）：探测语义退化为「存在性」——View 没有 disabled 概念，
    // isEnabled() 恒 true。若后续要判「可用态」（inputDisabled：无模型 / running /
    // 末条纯文本），需切到 WEBVIEW context 断言 textarea 的 readOnly，别在本探测上
    // 加回 enabled 分支。现状该探测仅作存在性用，不扩面。
    const input = await $(byTestId('chat-composer-input'));
    if (await input.isExisting()) {
      return;
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

    const empty = await $(
      'android=new UiSelector().textContains("暂无已保存模型")',
    );
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

    throw new Error(
      '[e2e] Model picker opened but no selectable model row found.',
    );
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
