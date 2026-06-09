import {appPage} from '../pageobjects/app.page';
import {vfsPage} from '../pageobjects/vfs.page';

describe('E1 VFS rename conflict', () => {
  before(async () => {
    await appPage.launchFresh('E2E VFS Rename');
    await appPage.switchToWorkspacePanel();
  });

  it('shows duplicate-name toast and keeps both files', async () => {
    await vfsPage.createFile('a.md');
    await vfsPage.createFile('b.md');
    await vfsPage.renameFile('b.md', 'a.md');

    const toast = await vfsPage.readToastMessage();
    expect(toast).toContain('名称不能重复');

    await vfsPage.expectRowVisible('a.md');
    await vfsPage.expectRowVisible('b.md');
  });
});
