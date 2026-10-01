import {switchToNative} from '../helpers/context';
import {alertPage} from './alert.page';
import {chatTranscriptPage} from './chat-transcript.page';

/**
 * 单次 e2e 进程的隔离后缀。
 *
 * noReset 之后（协作红线：任何设备都禁止卸载/清数据，应用数据跨 spec 残留），
 * 「每条 spec 重装清数据」这条老隔离手段没了——改由 spec **自建自清**。
 * 自建的项目名必须每轮唯一，否则第二次跑会命中上一轮遗留的同名项目，数据越滚越脏。
 */
const RUN_SUFFIX = `${Date.now().toString(36).slice(-5)}${Math.floor(
  Math.random() * 36,
).toString(36)}`;

/** 给 spec 的项目基名加本轮唯一后缀。 */
export function isolatedProjectName(base: string): string {
  return `${base}-${RUN_SUFFIX}`;
}

/**
 * 新建项目后自动生成的会话标题。
 *
 * `nextDefaultSessionTitle`（`utils/session-default-title.ts`）按项目内已用编号取下一个，
 * 所以**全新项目**里的第一个会话固定是「新会话1」。旧页对象用
 * `textMatches("会话.*")` 去找最新会话——那个模式连 SegmentedControl 上的「会话」
 * 标签和 ManageHeader 标题都会命中，在多会话场景下点到的未必是目标行。
 */
const NEW_SESSION_TITLE = '新会话1';

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

  /**
   * 打开新建出来的那个会话（标题固定「新会话1」）。
   *
   * @param title 精确标题；不传用 {@link NEW_SESSION_TITLE}（= 全新项目里的第一个会话）
   */
  async openLatestSession(title = NEW_SESSION_TITLE): Promise<void> {
    await switchToNative();
    const sessionTitle = await $(
      `android=new UiSelector().text("${title}")`,
    );
    if (!(await sessionTitle.isExisting())) {
      throw new Error(
        `[e2e] 会话行「${title}」不存在。` +
          '确认 createSession() 已成功（需要先选中项目），且项目内没有同名旧会话。',
      );
    }
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
   *
   * 两条探测现在都在 **web DOM** 里（chat-webview-unify 之后输入区整体进了合成包）：
   * - 「请先选择工作区模型」提示行 = dock 的 `#composer-hint-row`（RN 文本树里已不存在）；
   * - composer 输入 = 合成包里的 `textarea[data-testid="composer-input"]`
   *   （RN 容器上那个 `chat-composer-input` testID 随 `ChatComposer` 退役一起删了）。
   */
  async ensureWorkspaceModel(): Promise<void> {
    await this.switchToChatPanel();

    if (await chatTranscriptPage.isDockHintRowVisible()) {
      // 点提示行 → dockAction.needModel → 宿主打开工作区模型选择器（RN Modal）。
      await chatTranscriptPage.clickDockHintRow();
      await this.selectFirstWorkspaceModel();
      return;
    }

    if (await chatTranscriptPage.composerInputExists()) {
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

    const tabChat = await $(byTestId('tab-chat'));
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

  /**
   * Full UI seed: 全新项目 → 会话 → 对话页 → 工作区模型。
   *
   * 项目名自动加本轮唯一后缀（见 {@link isolatedProjectName}），返回值就是实际项目名——
   * spec 靠它在自己的 `after` 里调 {@link deleteProjectViaDrawer} 自清。
   */
  async launchFresh(projectBaseName = 'E2E'): Promise<string> {
    const projectName = isolatedProjectName(projectBaseName);
    await this.ensureProject(projectName);
    await this.createSession();
    await this.openLatestSession();
    await this.switchToChatPanel();
    await this.ensureWorkspaceModel();
    return projectName;
  }

  /**
   * 自清：UI 内删除本 spec 建的项目（其下会话与文件一并删除）。
   *
   * noReset 之后每条 spec 的隔离靠「自建自清」，这里就是清的那一半：
   * 抽屉 → 项目行 ⋮ 菜单 → 删除 → 确认框**先读正文里的项目名**再点删除
   * （红线：不可逆操作禁止盲点确认框）。
   *
   * 项目不存在时静默返回——清理是幂等的，spec 挂在 before 里时不该把 after 也带崩。
   */
  async deleteProjectViaDrawer(projectName: string): Promise<void> {
    await switchToNative();
    await this.leaveConversationIfNeeded().catch(() => undefined);
    await this.openProjectDrawer();

    const row = await $(`android=new UiSelector().text("${projectName}")`);
    if (!(await row.isExisting())) {
      await this.closeProjectDrawerIfOpen();
      return;
    }

    // ⋮ 在项目卡片内（ProjectDrawer.tsx 的 `project-menu-${id}` testID 用的 id 是 UI
    // 内部 id，页对象拿不到，只能按项目名文本反查所在卡片）。`[last()]` 取文档序最
    // 后一个 ⋮——即名字所在的最内层卡片里的那个，外层祖先 ViewGroup 也会被同一 XPath
    // 命中，不加限定会点到别的行。
    const more = await $(
      `(//android.view.ViewGroup[.//android.widget.TextView[@text="${projectName}"]]` +
        `//android.widget.TextView[@text="⋮"])[last()]`,
    );
    await more.waitForDisplayed({timeout: 10000});
    await more.click();

    const deleteItem = await $('android=new UiSelector().text("删除")');
    await deleteItem.waitForDisplayed({timeout: 5000});
    await deleteItem.click();

    // 确认框正文形如「确定删除项目「E2E X-abc12」？将同时移除其下所有会话。」
    await alertPage.acceptDestructive(`「${projectName}」`, '删除');
    await this.closeProjectDrawerIfOpen();
  }
}

export const appPage = new AppPage();
