import {excerptReleaseNotes} from '../../src/update-check/excerpt-release-notes';

const WORKFLOW_BODY = `## Android

| APK | ABI |
| --- | --- |
| NovelMaster-1.0.3-universal.apk | all (fat) |

Install tip: use universal.

## Desktop

| Platform | File |
| --- | --- |
| Windows | setup.exe`;

describe('excerptReleaseNotes', () => {
  it('strips markdown tables from mobile section', () => {
    const text = excerptReleaseNotes(WORKFLOW_BODY, 'mobile');
    expect(text).not.toMatch(/\|/);
    expect(text).toMatch(/universal/i);
  });
});
