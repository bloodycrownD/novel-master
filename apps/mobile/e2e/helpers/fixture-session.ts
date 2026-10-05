import {
  E2E_FIXTURE_ASSISTANT_MESSAGE_ID,
  E2E_FIXTURE_PROJECT_NAME,
  E2E_FIXTURE_SESSION_TITLE,
} from '../fixtures/session-ids';
import {switchToNative} from './context';
import {appPage} from '../pageobjects/app.page';

const FIXTURE_SKIP_ENV = 'E2E_ALLOW_FIXTURE_SKIP';
const FIXTURE_RUN_ENV = 'E2E_RUN_FIXTURE_SPECS';

/**
 * 依赖 DB 注入 fixture 的 spec 默认**跳过**，除非显式 `E2E_RUN_FIXTURE_SPECS=1`。
 *
 * 为什么默认跳过（别把它当省事，这是两条硬约束撞在一起）：
 * 1. fixture 靠 `e2e/scripts/inject-tool-turn-fixture.mjs` 拉/改/推应用沙箱里的
 *    SQLite——而「真机/模拟器验收一律从 UI 操作，库只读」是红线；
 * 2. noReset 之后应用数据跨 spec 残留，注入脚本自己会 `am force-stop` 应用，
 *    Appium 一旦已经接管就会把会话搅乱。
 *
 * 所以默认跳过并打警告；确要跑就先把 fixture 注入脚本跑一遍，再带上这个环境变量。
 */
export function fixtureSpecsEnabled(): boolean {
  return process.env[FIXTURE_RUN_ENV] === '1';
}

/** fixture spec 未显式开启时的统一提示（spec 里 `this.skip()` 前打一条，别静默）。 */
export function fixtureSpecsDisabledReason(): string {
  return (
    `[e2e] fixture spec 默认跳过（未设 ${FIXTURE_RUN_ENV}=1）：` +
    '该用例依赖应用沙箱 SQLite 注入，与「库只读」红线 + noReset 隔离冲突。' +
    '确需运行：先 npm run mobile:e2e:fixture，再以 E2E_RUN_FIXTURE_SPECS=1 重跑本轮。'
  );
}

/** Whether fixture specs may skip when the pre-seeded session is absent. */
export function allowFixtureSkip(): boolean {
  return process.env[FIXTURE_SKIP_ENV] === '1';
}

/** UiAutomator selector for the fixture session row in the session list. */
export function fixtureSessionSelector(
  title = E2E_FIXTURE_SESSION_TITLE,
): string {
  return `android=new UiSelector().textContains("${title}")`;
}

/**
 * True when the injected fixture session title appears in the session list.
 *
 * 会话列表已回 RN（`ChatSessionListPanel` 的会话行 FlatList），原生
 * `textContains` 走 a11y 树直接查得到；但**判定必须落在「fixture 项目的会话列表」
 * 上**——app 停在别的项目、或停在对话态（MainTabs 隐藏、列表不渲染）时直接查会
 * 误判 missing，所以先 `ensureProject` 再关抽屉，切完项目还要再关一次
 * （conversation 态点项目行后抽屉不一定自动关，盖着列表时会话行文本查不到）。
 *
 * （历史：会话列表在 WebView 里的那阵子，会话行是 web DOM 文本，原生
 * `textContains` 只有在列表视图可见时才暴露，这里因此多写过按 `data-view` 属性
 * 判「是不是列表视图」的配套 helper；回滚后那些判据一并删除。）
 */
export async function isFixtureSessionAvailable(
  projectName = E2E_FIXTURE_PROJECT_NAME,
  title = E2E_FIXTURE_SESSION_TITLE,
): Promise<boolean> {
  await appPage.dismissUpdateCheckModalOnce();
  await appPage.dismissLogboxIfPresent();
  await appPage.closeProjectDrawerIfOpen();
  try {
    await appPage.ensureProject(projectName);
  } catch {
    // 连 fixture 项目都切不进去（抽屉里没有/环境异常）——如实判不可用。
    return false;
  }
  // 切完项目再关一次抽屉：conversation 态点项目行后抽屉不一定自动关，
  // 盖着列表时会话行文本查不到。
  await appPage.closeProjectDrawerIfOpen();
  await switchToNative();
  const sessionTitle = await $(fixtureSessionSelector(title));
  return sessionTitle.isExisting();
}

/**
 * Open a pre-seeded fixture session (see `e2e/scripts/README.md`).
 * Requires `E2E_FIXTURE_SESSION_TITLE` (default) to match the injected session row.
 */
export async function openFixtureSession(
  projectName = E2E_FIXTURE_PROJECT_NAME,
  sessionTitle = E2E_FIXTURE_SESSION_TITLE,
): Promise<void> {
  await appPage.ensureProject(projectName);
  await appPage.waitForLaunch();

  const sessionRow = await $(fixtureSessionSelector(sessionTitle));
  const exists = await sessionRow.isExisting();
  if (!exists) {
    throw new Error(
      `[e2e] Fixture session "${sessionTitle}" not found. ` +
        'Run the adb/sqlite bootstrap in e2e/scripts/README.md first, ' +
        `or set ${FIXTURE_SKIP_ENV}=1 to allow skipping fixture specs.`,
    );
  }

  await sessionRow.click();
  await appPage.switchToChatPanel();
  await appPage.ensureWorkspaceModel();
}

/** Resolved assistant message id for fixture assertions (env override or default). */
export function fixtureAssistantMessageId(): string {
  return E2E_FIXTURE_ASSISTANT_MESSAGE_ID;
}
