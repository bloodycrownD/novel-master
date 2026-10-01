import {appPage} from '../pageobjects/app.page';
import {vfsPage} from '../pageobjects/vfs.page';

/**
 * E1 VFS 重名冲突。
 *
 * 隔离（noReset 之后的老手段失效，改自建自清）：
 * - before：UI 建**本轮唯一**项目 + 会话 → 进对话页（`launchFresh` 返回真实项目名）；
 * - after：UI 删掉这个项目——其下会话与 VFS 文件随项目一并删除。
 */
describe('E1 VFS rename conflict', () => {
  let projectName = '';

  before(async () => {
    projectName = await appPage.launchFresh('E2E VFS Rename');
    await appPage.switchToWorkspacePanel();
  });

  after(async () => {
    if (projectName === '') {
      return;
    }
    await appPage.deleteProjectViaDrawer(projectName);
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