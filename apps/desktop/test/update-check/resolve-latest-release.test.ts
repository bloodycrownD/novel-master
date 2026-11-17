import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UpdateCheck } from "@novel-master/core/common";

describe("resolveLatestRelease", () => {
  it("maps latest JSON fixture", async () => {
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: "v2.1.0",
          html_url: "https://github.com/bloodycrownD/novel-master/releases/tag/v2.1.0",
          body: "Release notes",
        }),
      }) as Response;

    const release = await UpdateCheck.resolveLatest(mockFetch);
    assert.equal(release.tagName, "v2.1.0");
    assert.equal(release.version, "2.1.0");
    assert.match(release.htmlUrl, /releases\/tag\/v2.1.0/);
    assert.equal(release.body, "Release notes");
  });
});
