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
 * 首屏「版本检查」弹窗的关闭候选（「今日不再提醒」优先，避免误触「去下载」）。
 *
 * 为什么三重兜底：弹窗按钮**同时带 `resource-id` 与 `content-desc`**（实测 dump：
 * `resource-id="update-check-result-snooze"` + `content-desc="今日不再提醒"`），
 * 而 Appium 的 `~id`（accessibility id）在 Android 上优先按 content-desc 匹配——
 * 只写 testID 可能查不到，所以显式 `resourceId` 打头、文案收尾。
 *
 * 末位的「取消」不是版本检查弹窗的按钮，而是 noReset 残留的**会话/项目 ⋮ 菜单**
 * 兜底（2026-10-01 全量实跑实锤：前一条 spec 自清失败会把菜单留在屏上，它同原生
 * Modal 一样抢走整棵 a11y 树，后续所有 spec 的 before 全卡 90s）。菜单里唯一安全
 * 的动作就是取消——排最后，只在版本检查候选全部落空时才轮到它。
 */
const UPDATE_MODAL_DISMISS_SELECTORS = [
  'android=new UiSelector().resourceId("update-check-result-snooze")',
  '~update-check-result-snooze',
  'android=new UiSelector().text("今日不再提醒")',
  'android=new UiSelector().text("关闭")',
  'android=new UiSelector().text("取消")',
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

/**
 * 抽屉全屏遮罩的热区判定与落点比例（r6-G2：原来是裸魔法数 0.8 / 0.81 / 0.09）。
 *
 * 背景见 {@link AppPage.closeProjectDrawerIfOpen}：全屏遮罩的中心被抽屉面板消费，
 * elementClick 点不动，只能改点「面板右界之外、header 之下的空白」。
 *
 * ⚠️ **MASK_TAP_Y_RATIO 与抽屉 header 高度强耦合**：y 取的是 header 下沿之下那一小段
 * 空白，抽屉 header 一改高（真源是 `src/components/chrome/AppHeader.tsx` 的
 * `APP_HEADER_CONTENT_HEIGHT`，当前 58），0.09 就会落进 header / 面板内容区，
 * 点击重新被面板吃掉，抽屉关不掉。改 header 高度时**必须同步复核 MASK_TAP_Y_RATIO**。
 *
 * MASK_TAP_X_RATIO 同理要留在「面板右界之外、会话行 ⋮ 菜单列（x≈0.88 屏宽起）之左」的
 * 窄缝里——面板宽度或 ⋮ 菜单列位置变了同样要复核。
 */
const MASK_FULLSCREEN_RATIO = 0.8;
const MASK_TAP_X_RATIO = 0.81;
const MASK_TAP_Y_RATIO = 0.09;

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
      await this.dismissLogboxIfPresent();
      const chatTab = await $('~对话');
      chatVisible = await chatTab.isDisplayed().catch(() => false);
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
        // 「关闭」收敛后挂在**全屏遮罩**上（2026-10-01 e2e 实跑实锤）：elementClick
        // 点元素中心，而全屏遮罩的中心落在抽屉面板内容上，点击被面板消费、遮罩的
        // onPress 不触发——抽屉永远关不掉（T-CU12 冒烟失败根因）。命中全屏元素
        // （宽 ≥ 80% 屏宽）时改点右侧热区（见 MASK_TAP_X_RATIO / MASK_TAP_Y_RATIO）。
        //
        // **失败诊断路径**：热区点空了抽屉还是关不掉时，别急着调比例数——先 dump 抽屉
        // UI（`adb shell uiautomator dump` 或 `browser.saveScreenshot`）看遮罩元素的
        // bounds 与抽屉面板 bounds，确认 (a) 遮罩是否真的全屏、(b) 热区落点有没有被
        // 面板 / header 盖住。两组 bounds 一比就知道该改 MASK_TAP_X_RATIO 还是
        // MASK_TAP_Y_RATIO（或 APP_HEADER_CONTENT_HEIGHT 变了）。
        const size = await close.getSize();
        const win = await browser.getWindowSize();
        if (size.width >= Math.round(win.width * MASK_FULLSCREEN_RATIO)) {
          await browser
            .action('pointer', {parameters: {pointerType: 'touch'}})
            .move({
              x: Math.round(win.width * MASK_TAP_X_RATIO),
              y: Math.round(win.height * MASK_TAP_Y_RATIO),
            })
            .down()
            .up()
            .perform();
        } else {
          await close.click();
        }
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
    // 等抽屉列表渲染稳定再查 existing：isExisting 是一次性查询，抽屉刚开时
    // 列表异步加载没完成会误判「项目不存在」→ 走 createProject 建出**同名
    // 新项目**（2026-10-02 实跑实锤：竞态窗口建出两个假「E2E Tool Turn」
    // 排在真身前面，后续轮全切到空项目、fixture 判定永远 missing）。
    // 以「任一项目的 ⋮ 菜单（project-menu-*）出现」为列表就绪判据。
    const anyMenu = await $(
      'android=new UiSelector().resourceIdMatches("project-menu-.*")',
    );
    await anyMenu.waitForDisplayed({timeout: 10000});
    const existing = await $(`android=new UiSelector().text("${name}")`);
    if (await existing.isExisting()) {
      await existing.click();
      await this.closeProjectDrawerIfOpen();
      return;
    }
    await this.closeProjectDrawerIfOpen();
    await this.createProject(name);
  }

  /**
   * dev 下 console.error 会弹 LogBox 错误横幅（无模型环境 run 失败的
   * `[session-stream-unit-manager] run failed` 就是必弹源），**长挂不自动
   * 消失**且是原生 Modal 层——盖住整棵 a11y 树，tab-chat/会话行全部查不到
   * （2026-10-02 实跑实锤：waitForConversationEntered 等 tab-chat 假超时）。
   * 点横幅展开 LogBox 后 dismiss（找不到按钮就用 BACK 兜底）。
   */
  async dismissLogboxIfPresent(): Promise<void> {
    await switchToNative();
    const bar = await $(
      'android=new UiSelector().descriptionContains("Open debugger to view warnings")',
    );
    if (!(await bar.isExisting())) {
      return;
    }
    await bar.click();
    await browser.pause(800);
    const dismiss = await $('android=new UiSelector().textContains("ismiss")');
    if (await dismiss.isExisting()) {
      await dismiss.click();
    } else {
      await driver.back();
    }
    await browser.pause(500);
  }

  /**
   * 新建会话（点会话列表头的「新建会话」）。
   *
   * 会话列表已回 RN（`ChatSessionListPanel`：`ManageHeader` + 会话行 `FlatList`），
   * 所以走原生 a11y 定位即可：`UiSelector().text("新建会话")` 命中 ManageHeader
   * 里那个 `PrimaryButton`。合成包 WebView 不参与这一步。
   *
   * 点击后 `handleCreateSession` 只**创建+刷列表**、不选会话也不切视图，
   * 所以固定 pause 一小段，等新行渲染进 FlatList 再由 {@link openLatestSession} 进。
   */
  async createSession(): Promise<void> {
    await switchToNative();
    const createSession = await $('android=new UiSelector().text("新建会话")');
    await createSession.waitForDisplayed({timeout: 10000});
    await createSession.click();
    await browser.pause(800);
  }

  /**
   * 打开会话列表里最新新建的那个会话。
   *
   * 会话行回到 RN FlatList 后，`textMatches("会话.*")` 又能用了：`nextDefaultSessionTitle`
   * 按项目内编号生成（「新会话1」「新会话2」…），`launchFresh` 建的是**全新空项目**，
   * 列表里只有刚建的那一行，所以第一个匹配就是目标。
   *
   * ⚠️ 这个模式**不区分**原生 SegmentedControl 上的「会话」标签和 ManageHeader 的
   * 「会话」标题——那两处在多会话项目下也会命中。空项目场景下无碍（列表只有一行，
   * 切换条/标题在 WebView 文档里、而查询走的是原生树）；若日后要在**已有多个会话**
   * 的项目里用本方法，得改成按行精确匹配。
   */
  async openLatestSession(): Promise<void> {
    await switchToNative();
    const sessionTitle = await $(
      'android=new UiSelector().textMatches("会话.*")',
    );
    await sessionTitle.waitForDisplayed({timeout: 10000});
    await sessionTitle.click();
    await this.waitForConversationEntered();
  }

  /**
   * 等「已进入会话」（原生 tab-chat 可见）。
   *
   * 等待期间可能被**后到的 Modal** 盖住 a11y 树（2026-10-02 实跑实锤）：
   * 「版本检查」弹窗在 forceAppLaunch 后数十秒才弹（模拟器无外网，网络超时
   * 晚于主界面就绪），项目抽屉也可能从更早的步骤残留——两者都是原生 Modal，
   * 开着时整棵树只剩 Modal 内容、tab-chat 永远查不到（与 waitForLaunch 的
   * 弹窗互为同因）。所以这里做互查循环（waitForLaunch 同款模式）：每轮先
   * 点掉弹窗、再关抽屉、后查 tab-chat，两种 Modal 都能自愈——单纯
   * waitForDisplayed 会在「弹窗晚到」时死等 15s 假失败。
   */
  private async waitForConversationEntered(timeoutMs = 20000): Promise<void> {
    await switchToNative();
    const deadline = Date.now() + timeoutMs;
    let tabVisible = false;
    while (Date.now() < deadline) {
      await this.dismissUpdateCheckModalOnce();
      await this.dismissLogboxIfPresent();
      await this.closeProjectDrawerIfOpen();
      const chatTab = await $(byTestId('tab-chat'));
      tabVisible = await chatTab.isDisplayed().catch(() => false);
      if (tabVisible) {
        return;
      }
      await browser.pause(1000);
    }
    throw new Error(
      '[e2e] 进入会话后 tab-chat 20s 内未显示：已每秒尝试关闭「版本检查」弹窗与' +
        '项目抽屉仍未恢复——检查 app 是否卡在别的 Modal 或启动失败。',
    );
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

    // 合成包加载窗口（屏上「正在加载输入区…」）：textarea 与 hint-row 都还没
    // 挂出来，直接探测会把「还在加载」误判成「两者皆无」、走「回列表 → 我的」
    // 的旧兜底路径（2026-10-02 实跑实锤）。先等二者居一再分流。
    await browser.waitUntil(
      async () =>
        (await chatTranscriptPage.isDockHintRowVisible()) ||
        (await chatTranscriptPage.composerInputExists()),
      {
        timeout: 20000,
        timeoutMsg: 'composer 区 20s 未就绪（hint-row 与 textarea 都没出现）',
      },
    );

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
    // 「新建会话」只**创建+刷列表**，app 停在 RN 会话列表（useChatTabScope.
    // handleCreateSession 不选会话）；而 tab-chat 在列表态被 display:none 整行收起
    // （ChatConversationPanel）——等 tab-chat 等不出来，正路就是点列表行进会话
    // （openLatestSession），进去后 tab-chat 才显示。
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
    // UiSelector 走 a11y 全树（屏外也命中），但下方的 XPath ⋮ 只搜**可见子树**——
    // 项目逐轮堆积（noReset，after 失败一轮就多残留一个）后目标行常在屏外，
    // XPath 直接跑必然 not existing（2026-10-01 e2e 全量实锤）。先把行本身滚进
    // 可视区，XPath 才有得搜。
    await row.scrollIntoView();

    // ⋮ 在项目卡片内（ProjectDrawer.tsx 的 `project-menu-${id}` testID 用的 id 是 UI
    // 内部 id，页对象拿不到，只能按项目名文本反查所在卡片）。`[last()]` 取文档序最
    // 后一个 ⋮——即名字所在的最内层卡片里的那个，外层祖先 ViewGroup 也会被同一 XPath
    // 命中，不加限定会点到别的行。
    const more = await $(
      `(//android.view.ViewGroup[.//android.widget.TextView[@text="${projectName}"]]` +
        `//android.widget.TextView[@text="⋮"])[last()]`,
    );
    await more.waitForExist({timeout: 10000});
    await more.waitForDisplayed({timeout: 5000});
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
