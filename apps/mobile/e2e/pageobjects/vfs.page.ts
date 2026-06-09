import {switchToNative} from '../helpers/context';

/** Native VFS file manager inside chat workspace panel. */
export class VfsPage {
  async openMoreMenu(): Promise<void> {
    await switchToNative();
    const more = await $('~vfs-more-action');
    await more.waitForDisplayed({timeout: 10000});
    await more.click();
  }

  async createFile(name: string): Promise<void> {
    await this.openMoreMenu();
    const item = await $('android=new UiSelector().text("新建文件")');
    await item.waitForDisplayed({timeout: 5000});
    await item.click();
    const input = await $('~vfs-prompt-input');
    await input.waitForDisplayed({timeout: 5000});
    await input.setValue(name);
    const submit = await $('~vfs-prompt-submit');
    await submit.click();
    await browser.pause(600);
  }

  async openRowMenu(fileName: string): Promise<void> {
    await switchToNative();
    const menu = await $(`~vfs-row-menu-${fileName}`);
    await menu.waitForDisplayed({timeout: 10000});
    await menu.click();
  }

  async renameFile(fromName: string, toName: string): Promise<void> {
    await this.openRowMenu(fromName);
    const rename = await $('android=new UiSelector().text("重命名")');
    await rename.waitForDisplayed({timeout: 5000});
    await rename.click();
    const input = await $('~vfs-prompt-input');
    await input.waitForDisplayed({timeout: 5000});
    await input.clearValue();
    await input.setValue(toName);
    const submit = await $('~vfs-prompt-submit');
    await submit.click();
    await browser.pause(600);
  }

  async expectRowVisible(fileName: string): Promise<void> {
    await switchToNative();
    const row = await $(`~vfs-row-${fileName}`);
    await row.waitForDisplayed({timeout: 10000});
  }

  async expectRowMissing(fileName: string): Promise<void> {
    await switchToNative();
    const row = await $(`~vfs-row-${fileName}`);
    await row.waitForExist({timeout: 3000, reverse: true});
  }

  async readToastMessage(): Promise<string> {
    await switchToNative();
    const toast = await $('~toast-message');
    await toast.waitForDisplayed({timeout: 10000});
    return toast.getText();
  }
}

export const vfsPage = new VfsPage();
