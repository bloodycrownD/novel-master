import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkplaceService } from "@novel-master/core/workplace";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/**
 * huge-card-import-crash 回归：单目录海量文件下规则视图的排名语义与成本。
 *
 * 旧实现对每个文件重新排序其全部兄弟（O(N²·logN)），556 文件的世界书在真机
 * 上一次评估分钟级并占死 JS 线程（用户表现为进工作区永久「加载中…」）。
 * 修复后每目录只排序一次；本测试同时校验大目录下的 header/tail 截取语义
 * （首/末文件的展示档位）与列表行数，防止未来重构再回退到逐文件排序。
 */
describe("workplace rule engine 大目录性能与语义回归", () => {
  it("T-WECP1：600 文件单目录——tail 截取的末位语义、auto 名次与行数完整", async () => {
    const testCtx = getNovelMasterTestContext();
    const project = await testCtx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = testCtx.projectVfs(project.id);

    const TOTAL = 600;
    const names: string[] = [];
    for (let i = 0; i < TOTAL; i++) {
      // 文件名带非 ASCII（模拟世界书 emoji/CJK 场景）与数字序号
      const name = `/世界书/条目${String(i).padStart(4, "0")}·📖.md`;
      names.push(name);
      await pvfs.write(name, `内容 ${i}`);
    }

    const wt = createWorkplaceService(testCtx.conn, {
      kind: "project",
      projectId: project.id,
    });
    await wt.setDirRule({
      logicalPath: "/世界书",
      ruleEnabled: true,
      sortField: "name",
      sortOrder: "asc",
      // 截取语义：排序后保留首 headCount + 末 tailCount 名，其余按 fillPolicy；
      // 这里首 10 名得 full、其余 hidden，验证名次表与截取联动
      headCount: 10,
      tailCount: 0,
      fillPolicy: "hidden",
    });

    const t0 = Date.now();
    const view = await wt.buildListRows();
    const elapsed = Date.now() - t0;

    const dirRow = view.find((r) => r.kind === "dir" && r.path === "/世界书");
    assert.ok(dirRow, "目录行存在");
    const fileRows = view.filter((r) => r.kind === "file") as Array<{
      kind: "file";
      path: string;
      displayState: string;
    }>;
    assert.equal(fileRows.length, TOTAL, "全部文件都有列表行");

    // 排序前 10 名（数字序号 0000-0009）在 headCount=10 截取下应 full，
    // 其余文件按 fillPolicy=hidden —— 验证 auto 名次表与截取联动正确
    const byName = new Map(fileRows.map((r) => [r.path, r]));
    const inHead = byName.get(`/世界书/条目0000·📖.md`);
    assert.ok(inHead, "首名文件存在列表行");
    assert.equal(inHead.displayState, "full", "headCount=10 下首名文件全量展示");
    const outOfHead = byName.get(`/世界书/条目0599·📖.md`);
    assert.ok(outOfHead, "末名文件存在列表行");
    assert.equal(outOfHead.displayState, "hidden", "超出截取窗口的末名文件隐藏");

    // 性能哨兵：600 文件在 CI 桌面应在数百 ms 内完成（含 600 次 DB 写入的
    // fixture 成本不在此计量内——elapsed 仅包住 buildListRows）
    assert.ok(elapsed < 2000, `buildListRows 应远快于旧实现，实际 ${elapsed}ms`);
  });

  it("T-WECP2：非 auto 文件（显式 show）在 auto 名次缺失时语义不变", async () => {
    const testCtx = getNovelMasterTestContext();
    const project = await testCtx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = testCtx.projectVfs(project.id);
    await pvfs.write("/d/a.md", "a");
    await pvfs.write("/d/b.md", "b");

    const wt = createWorkplaceService(testCtx.conn, {
      kind: "project",
      projectId: project.id,
    });
    // b 显式 show（非 auto）：auto 名次表中无 b，旧实现 index 兜底 0
    await wt.setFileRule({logicalPath: "/d/b.md", inclusionMode: "show"});

    const view = await wt.buildListRows();
    const bRow = view.find((r) => r.kind === "file" && r.path === "/d/b.md") as
      | {kind: "file"; displayState: string}
      | undefined;
    assert.ok(bRow, "显式规则文件存在列表行");
    assert.equal(bRow.displayState, "full", "显式 show 展示全内容");
  });
});
