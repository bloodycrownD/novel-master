import {switchToNative} from '../helpers/context';

/** Android system Alert used for rollback confirmation. */
export class AlertPage {
  async acceptRollback(): Promise<void> {
    await switchToNative();
    try {
      await browser.acceptAlert();
      return;
    } catch {
      /* fall through to UiAutomator */
    }
    const confirm = await $('android=new UiSelector().text("回滚")');
    await confirm.waitForDisplayed({timeout: 5000});
    await confirm.click();
  }

  async dismiss(): Promise<void> {
    await switchToNative();
    try {
      await browser.dismissAlert();
    } catch {
      const cancel = await $('android=new UiSelector().text("取消")');
      if (await cancel.isExisting()) {
        await cancel.click();
      }
    }
  }
}

export const alertPage = new AlertPage();
