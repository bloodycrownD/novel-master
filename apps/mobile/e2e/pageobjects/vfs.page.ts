import {switchToNative} from '../helpers/context';

/**
 * RN `testID` → resourceId 选择器（app.page.ts 同款坑）：
 * UiAutomator2 的 `~`（accessibility id）按 content-desc 匹配，而 VFS 的 testID
 * （vfs-more-action 等）落到的是 resource-id、content-desc 是中文 label
 * （如「更多操作」）——`~vfs-more-action` 永远找不到（2026-10-01 e2e 实跑实锤，
 * 此前 E1/E3 两条 spec 全挂在这个选择器上）。
 */
const byTestId = (testId: string): string =>
  `android=new UiSelector().resourceId("${testId}")`;

/** Native VFS file manager inside chat workspace panel. */
export class VfsPage {
  async openMoreMenu(): Promise<void> {
    await switchToNative();
    const more = await $(byTestId('vfs-more-action'));
    await more.waitForDisplayed({timeout: 10000});
    await more.click();
  }

  async createFile(name: string): Promise<void> {
    await this.openMoreMenu();
    const item = await $('android=new UiSelector().text("新建文件")');
    await item.waitForDisplayed({timeout: 5000});
    await item.click();
    const input = await $(byTestId('vfs-prompt-input'));
    await input.waitForDisplayed({timeout: 5000});
    await input.setValue(name);
    const submit = await $(byTestId('vfs-prompt-submit'));
    await submit.click();
    await browser.pause(600);
  }

  async openRowMenu(fileName: string): Promise<void> {
    await switchToNative();
    const menu = await $(byTestId(`vfs-row-menu-${fileName}`));
    await menu.waitForDisplayed({timeout: 10000});
    await menu.click();
  }

  async renameFile(fromName: string, toName: string): Promise<void> {
    await this.openRowMenu(fromName);
    const rename = await $('android=new UiSelector().text("重命名")');
    await rename.waitForDisplayed({timeout: 5000});
    await rename.click();
    const input = await $(byTestId('vfs-prompt-input'));
    await input.waitForDisplayed({timeout: 5000});
    await input.clearValue();
    await input.setValue(toName);
    const submit = await $(byTestId('vfs-prompt-submit'));
    await submit.click();
    await browser.pause(600);
  }

  async expectRowVisible(fileName: string): Promise<void> {
    await switchToNative();
    const row = await $(byTestId(`vfs-row-${fileName}`));
    await row.waitForDisplayed({timeout: 10000});
  }

  async expectRowMissing(fileName: string): Promise<void> {
    await switchToNative();
    const row = await $(byTestId(`vfs-row-${fileName}`));
    await row.waitForExist({timeout: 3000, reverse: true});
  }

  /**
   * 读 toast 正文，读到空串直接抛错。
   *
   * 为什么不能把空串原样返回（r6-G3）：E1 的失败根因之一就是 toast **读到空**——
   * `waitForDisplayed` 只保证元素在屏上，RN 的 ToastHost 挂上去到填字之间有一小段
   * 空窗，这窗口里 `getText()` 拿到的是空串，spec 拿它去 `toContain('名称不能重复')`
   * 必红，而且报的错完全指不到真正的原因（看起来像产品没弹提示，其实是读早了）。
   * 所以读完立刻断言非空，读空就抛「toast 读空」，把「读早了」和「提示没弹」两种
   * 情况在报错层面分开。
   *
   * 另外注意调用方别在上一个动作后立刻读：toast 有 TOAST_MS 驻留期（ToastHost.tsx
   * 默认 2500ms，带按钮的 8000ms），上一条 spec / 上一个动作的残留 toast 会盖住新的
   * （这属于调用节奏问题，这里读空、读旧都拦不住，残留只能靠 spec 自清或等驻留期过去）。
   */
  async readToastMessage(): Promise<string> {
    await switchToNative();
    const toast = await $(byTestId('toast-message'));
    await toast.waitForDisplayed({timeout: 10000});
    // ToastHost 挂载到填字之间有空窗；且 waitForDisplayed 命中的可能是**上一条
    // 残留 toast**（noReset 下前动作的 toast 尾巴），轮询中途它到期卸载、新的
    // 还没挂上——两种情况都会让 getText 抛 element-not-found/stale（2026-10-01
    // 全量实跑实锤）。轮询内吞掉这两类异常继续等下一条非空正文，3s 上限。
    const deadline = Date.now() + 3000;
    let text = '';
    while (Date.now() < deadline) {
      try {
        text = ((await toast.getText()) ?? '').trim();
      } catch {
        text = ''; // 元素被顶掉/未挂上——继续等
      }
      if (text !== '') {
        return text;
      }
      await browser.pause(150);
    }
    throw new Error(
      '[e2e] toast 读空：toast-message 已 displayed 但 3s 内正文始终为空。' +
        '若刚做过会弹 toast 的动作，多半是 ToastHost 挂载/填字链路异常或 toast 已被顶掉；' +
        '若没做过，则是宿主确实没弹提示——两种情况报错指向不同，别混。',
    );
  }
}

export const vfsPage = new VfsPage();
