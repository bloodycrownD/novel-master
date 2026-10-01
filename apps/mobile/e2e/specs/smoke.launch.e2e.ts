import {appPage} from '../pageobjects/app.page';

/**
 * E0 冒烟：冷启动后主界面可用。
 *
 * 隔离说明：本 spec **不建任何数据**，所以没有自清动作——它只看首屏。
 * noReset 之后这里不会因为上一轮残留而失效（只看 tab 是否可见）。
 */
describe('E0 smoke launch', () => {
  it('shows chat tab after app launch', async () => {
    await appPage.waitForLaunch();
    const chatTab = await $('~对话');
    await expect(chatTab).toBeDisplayed();
  });
});