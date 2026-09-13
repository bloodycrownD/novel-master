import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkplaceService } from "@novel-master/core/workplace";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

// 独立文件（独享库）：本用例验证懒加载口径，必须保证评估时库里不存在其他
// enabled+smart 目录规则——共享库文件里其他用例的 smart 规则残留会让旧实现
// （ruleEnabled 预过滤）意外触发规则加载、掩盖 disabled+smart 的退化行为。
novelMasterTestFixture();

describe("smart 规则懒加载口径", () => {
  it("T-WE3c: ruleEnabled true/false 排序输出一致，disabled+smart 不退化为 name 字典序（core/B-1）", async () => {
    const ctx = getNovelMasterTestContext();
    const gvfs = ctx.globalVfs();
    await gvfs.write("/novel/第十章.md", "TEN");
    await gvfs.write("/novel/第四章.md", "FOUR");
    await gvfs.write("/novel/第一章.md", "ONE");

    const wt = createWorkplaceService(ctx.conn, { kind: "global" });
    const ruleBase = {
      logicalPath: "/novel",
      sortField: "smart" as const,
      sortOrder: "asc" as const,
      headCount: 0,
      tailCount: 0,
      fillPolicy: "hidden" as const,
    };
    const listNovelPaths = async () =>
      (await wt.buildListRows())
        .filter((r) => r.path.startsWith("/novel/"))
        .map((r) => r.path);

    // 同一规则集：仅切 ruleEnabled，排序输出应一致（与 created/updated 的
    // disabled-仍生效基线对齐；修复前 disabled 时拿到空规则集退化成自然排序）
    await wt.setDirRule({ ...ruleBase, ruleEnabled: true });
    const enabledPaths = await listNovelPaths();
    await wt.setDirRule({ ...ruleBase, ruleEnabled: false });
    const disabledPaths = await listNovelPaths();
    assert.deepEqual(disabledPaths, enabledPaths);

    // disabled+smart 仍是智能序（中文数字升序），而非 name 字典序——用同库
    // sortField=name 的实际输出做对照，证明未退化
    await wt.setDirRule({ ...ruleBase, sortField: "name" });
    const namePaths = await listNovelPaths();
    assert.notDeepEqual(disabledPaths, namePaths);
    assert.deepEqual(enabledPaths, [
      "/novel/第一章.md",
      "/novel/第四章.md",
      "/novel/第十章.md",
    ]);
  });
});
