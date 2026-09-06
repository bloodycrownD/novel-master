/**
 * 内置 agent-config 技能 seed 集成测试（T-AS1 + 版本化升级 T-AS4）。
 *
 * - 全新库 bootstrap 后 global 域可见 agent-config 且内容与常量一致。
 * - 用户改过正文后再跑 seedBuiltinSkills 不覆盖（幂等跳过）。
 * - 版本化升级：停在历史官方文案（v1/v2）的库自动升到当前版；台账已
 *   应用当前版时早退（不读不写技能）。
 *
 * @module test/bootstrap/seed-builtin-skills
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import { createSkillsService } from "@novel-master/core/skills";
import {
  AGENT_CONFIG_SKILL_MD,
  seedBuiltinSkills,
} from "../../src/bootstrap/skills/seed-builtin-skills.js";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

async function openMemory() {
  registerBetterSqlite3Driver();
  return open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

/** 用户编辑后的版本（front matter 保持 name 与目录一致，维持有效态）。 */
const USER_EDITED_HEADING = "用户改过的指南";

describe("内置 agent-config 技能 seed（T-AS1）", () => {
  it("全新库 bootstrap 后 global 域可见 agent-config 且内容与常量一致", async () => {
    const conn = await openMemory();
    await bootstrapNovelMaster(conn);

    const skills = createSkillsService(conn);
    const list = await skills.listSkills("global");
    const item = list.find((s) => s.name === "agent-config");
    assert.ok(item != null, "bootstrap 后 global 清单应含 agent-config");
    assert.equal(item.valid, true, "front matter 应过 strict 校验");

    const read = await skills.readSkillFile("global", "agent-config");
    assert.equal(read.content, AGENT_CONFIG_SKILL_MD);

    await conn.close();
  });

  it("预置用户改动后再跑 seedBuiltinSkills：内容保持用户版不变（幂等跳过）", async () => {
    const conn = await openMemory();
    await bootstrapNovelMaster(conn);

    const skills = createSkillsService(conn);
    // 用户在种入版之上编辑（目录已存在，编辑路径放行；整文件覆盖有乐观锁墙，
    // 走 editSkillFile 的 replace 语义）
    await skills.editSkillFile("global", "agent-config", undefined, {
      oldString: "agent 配置指南",
      newString: USER_EDITED_HEADING,
    });

    // 模拟下次启动重跑 seed：已存在即跳过，不得覆盖用户改动
    await seedBuiltinSkills(conn);

    const read = await skills.readSkillFile("global", "agent-config");
    assert.match(read.content, /用户改过的指南/);
    assert.doesNotMatch(read.content, /agent 配置指南/);

    await conn.close();
  });
});

/** 读历史文案夹具（与 src 内嵌的 HISTORICAL 常量逐字同源，从 git 历史提取）。 */
function historicalFixture(name: string): string {
  const path = fileURLToPath(
    new URL(`../fixtures/${name}`, import.meta.url),
  );
  return readFileSync(path, "utf8");
}

/** 清空 seed 台账（模拟从未应用过版本化 seed 的存量库）。 */
async function clearSeedLedger(conn: Parameters<typeof seedBuiltinSkills>[0]): Promise<void> {
  await conn.execute(
    "DELETE FROM kkv_entry WHERE module = 'nm-seeds' AND key = 'agent-config'",
  );
}

describe("内置 agent-config 技能 seed 版本化升级（T-AS4）", () => {
  it("停在 v1 官方文案的库：清台账重跑 seed → 内容升级到当前版", async () => {
    const conn = await openMemory();
    await bootstrapNovelMaster(conn);
    const skills = createSkillsService(conn);
    const v1 = historicalFixture("agent-config-seed-v1.md");

    // 模拟 v1 时代初始化、从未应用版本化 seed 的库：内容回写 v1 + 无台账。
    await skills.writeSkillFile("global", "agent-config", undefined, v1, undefined);
    await clearSeedLedger(conn);

    await seedBuiltinSkills(conn);

    const read = await skills.readSkillFile("global", "agent-config");
    assert.equal(read.content, AGENT_CONFIG_SKILL_MD);
    await conn.close();
  });

  it("停在 v2 官方文案的库：同样升级到当前版", async () => {
    const conn = await openMemory();
    await bootstrapNovelMaster(conn);
    const skills = createSkillsService(conn);
    const v2 = historicalFixture("agent-config-seed-v2.md");

    await skills.writeSkillFile("global", "agent-config", undefined, v2, undefined);
    await clearSeedLedger(conn);
    await seedBuiltinSkills(conn);

    const read = await skills.readSkillFile("global", "agent-config");
    assert.equal(read.content, AGENT_CONFIG_SKILL_MD);
    await conn.close();
  });

  it("用户改过的库（内容不认识）：不覆盖，台账前进不重试", async () => {
    const conn = await openMemory();
    await bootstrapNovelMaster(conn);
    const skills = createSkillsService(conn);

    // 用户改过 = 内容不等于任何官方版本
    await skills.editSkillFile("global", "agent-config", undefined, {
      oldString: "agent 配置指南",
      newString: USER_EDITED_HEADING,
    });
    await clearSeedLedger(conn);

    await seedBuiltinSkills(conn);
    let read = await skills.readSkillFile("global", "agent-config");
    assert.match(read.content, /用户改过的指南/);

    // 台账前进后：即使内容保持用户版，后续启动早退（不再读技能内容）。
    // 此处用「写坏内容也不会被刷新」来证明早退：直接篡改为任意脏文本。
    await skills.writeSkillFile(
      "global", "agent-config", undefined, "脏文本，不该被 seed 碰", undefined,
    );
    await seedBuiltinSkills(conn);
    read = await skills.readSkillFile("global", "agent-config");
    assert.equal(read.content, "脏文本，不该被 seed 碰");
    await conn.close();
  });

  it("稳态台账（已应用当前版）：seed 直接早退，内容原样", async () => {
    const conn = await openMemory();
    await bootstrapNovelMaster(conn);
    const skills = createSkillsService(conn);

    // 台账已=当前版（bootstrap 首种即写入）：篡改内容后 seed 不得回写。
    await skills.writeSkillFile(
      "global", "agent-config", undefined, "稳态脏文本", undefined,
    );
    await seedBuiltinSkills(conn);
    const read = await skills.readSkillFile("global", "agent-config");
    assert.equal(read.content, "稳态脏文本");
    await conn.close();
  });
});
