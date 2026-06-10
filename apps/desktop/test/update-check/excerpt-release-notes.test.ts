import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { excerptReleaseNotes } from "../../src/main/update-check/excerpt-release-notes.js";

const WORKFLOW_BODY = `# Novel Master v1.0.3

## Android

| APK | ABI |
| --- | --- |
| NovelMaster-1.0.3-universal.apk | all (fat) |

**Install tip:** use universal on most phones.

## Desktop

| Platform | File |
| --- | --- |
| Windows (NSIS) | NovelMaster-1.0.3-windows-setup.exe |

**Desktop note:** installers are unsigned.`;

describe("excerptReleaseNotes", () => {
  it("prefers Desktop section without table pipes", () => {
    const text = excerptReleaseNotes(WORKFLOW_BODY, "desktop");
    assert.ok(!text.includes("|"));
    assert.match(text, /unsigned/i);
    assert.doesNotMatch(text, /universal\.apk/);
  });

  it("prefers Android section for mobile focus", () => {
    const text = excerptReleaseNotes(WORKFLOW_BODY, "mobile");
    assert.ok(!text.includes("|"));
    assert.match(text, /universal/i);
    assert.doesNotMatch(text, /windows-setup/);
  });

  it("returns fallback when body is empty", () => {
    const text = excerptReleaseNotes("", "desktop");
    assert.match(text, /GitHub Releases/);
  });
});
