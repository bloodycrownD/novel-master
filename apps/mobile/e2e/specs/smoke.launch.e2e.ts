import {appPage} from '../pageobjects/app.page';

describe('E0 smoke launch', () => {
  it('shows chat tab after app launch', async () => {
    await appPage.waitForLaunch();
    const chatTab = await $('~对话');
    await expect(chatTab).toBeDisplayed();
  });
});
