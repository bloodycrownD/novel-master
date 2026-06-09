import {
  E2E_FIXTURE_ASSISTANT_MESSAGE_ID,
  E2E_FIXTURE_PROJECT_NAME,
  E2E_FIXTURE_SESSION_TITLE,
} from '../fixtures/session-ids';
import {appPage} from '../pageobjects/app.page';

const FIXTURE_SKIP_ENV = 'E2E_ALLOW_FIXTURE_SKIP';

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

/** True when the injected fixture session title appears in the native session list. */
export async function isFixtureSessionAvailable(
  title = E2E_FIXTURE_SESSION_TITLE,
): Promise<boolean> {
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
