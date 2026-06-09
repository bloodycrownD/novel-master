import fs from 'node:fs';
import path from 'node:path';
import 'expect-webdriverio';
import {sharedConfig} from './wdio.shared.conf';

const e2eRoot = path.resolve(process.cwd(), 'e2e');
const screenshotsDir = path.join(e2eRoot, 'artifacts/screenshots');
const pageSourceDir = path.join(e2eRoot, 'artifacts/page-source');

for (const dir of [screenshotsDir, pageSourceDir]) {
  fs.mkdirSync(dir, {recursive: true});
}

export const config = {
  ...sharedConfig,
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      transpileOnly: true,
      project: path.join(e2eRoot, 'tsconfig.json'),
    },
  },
  afterTest: async (
    test: {title: string},
    _context: unknown,
    result: {passed: boolean},
  ) => {
    const contexts = await browser.getContexts();
    const active = await browser.getContext();
    console.log('[e2e] contexts:', contexts, 'active:', active);

    if (result.passed) {
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = test.title.replace(/[^\w.-]+/g, '_');
    const screenshotPath = path.join(
      screenshotsDir,
      `${safeTitle}-${stamp}.png`,
    );
    await browser.saveScreenshot(screenshotPath);

    const pageSource = await browser.getPageSource();
    fs.writeFileSync(
      path.join(pageSourceDir, `${safeTitle}-${stamp}.xml`),
      pageSource,
      'utf8',
    );
  },
};
