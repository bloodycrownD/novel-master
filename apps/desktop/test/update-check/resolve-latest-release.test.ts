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

  // 迁自 apps/mobile/__tests__/update-check/resolve-latest-release.test.ts：
  // 域名白名单已并入 core 共享实现，断言原样保留。
  it("rejects evil release domains", async () => {
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: "v2.1.0",
          html_url: "https://evil.example/bloodycrownD/novel-master/releases/tag/v2.1.0",
          body: "",
        }),
      }) as Response;

    await assert.rejects(UpdateCheck.resolveLatest(mockFetch), /发行版链接域名校验失败/);
  });
});
