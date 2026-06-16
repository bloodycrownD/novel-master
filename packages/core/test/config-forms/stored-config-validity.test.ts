import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode } from "@novel-master/core";
import { agentDefinitionSchema } from "@novel-master/core/agent";
import { EVENT_SESSION_COMPACTION_REQUESTED } from "@/domain/events/model/event-types.js";
import { eventsConfigSchema } from "@/domain/events-config/model/events-config.schema.js";
import { DEFAULT_EVENTS_CONFIG } from "@/domain/events-config/logic/default-events.js";
import {
  assessAgentDefinitionWire,
  assessEventsConfigWire,
  buildDefaultAgentDefinitionPreservingName,
  STORED_CONFIG_LABELS,
} from "../../src/config-forms/stored-config-validity/index.js";
import {
  createDefaultAgentEditorPrompts,
  layoutFromFormInput,
} from "../../src/config-forms/agent/agent-editor-state.js";
import { SqliteAgentDefinitionRepository } from "../../src/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import { DefaultEventsConfigStore } from "../../src/service/events-config/impl/events-config-store.service.js";
import { kkvNotFound } from "../../src/errors/kkv-errors.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

const COMPACTION = EVENT_SESSION_COMPACTION_REQUESTED;

describe("assessEventsConfigWire", () => {
  it("T-E1: v1 parallel wire → invalid(outdated_version)", () => {
    const wire = {
      schemaVersion: 1,
      events: {
        [COMPACTION]: {
          parallel: [{ "hide-message": { "start-depth": 6 } }],
        },
      },
    };
    const health = assessEventsConfigWire(wire);
    assert.equal(health.status, "invalid");
    if (health.status === "invalid") {
      assert.equal(health.code, "outdated_version");
      assert.equal(health.storedSchemaVersion, 1);
    }
  });

  it("T-E2: v2 合法 DAG → valid", () => {
    const wire = encode(DEFAULT_EVENTS_CONFIG, eventsConfigSchema);
    const health = assessEventsConfigWire(wire);
    assert.equal(health.status, "valid");
    if (health.status === "valid") {
      assert.equal(health.value.schemaVersion, 2);
      assert.equal(health.value.events[COMPACTION]?.[0]?.type, "hide-message");
    }
  });

  it("T-E3: v2 含 refresh-macros → invalid(removed_feature)", () => {
    const wire = {
      schemaVersion: 2,
      events: {
        [COMPACTION]: ["refresh-macros"],
      },
    };
    const health = assessEventsConfigWire(wire);
    assert.equal(health.status, "invalid");
    if (health.status === "invalid") {
      assert.equal(health.code, "removed_feature");
      assert.match(health.message, /refresh-macros/i);
    }
  });

  it("T-E4: 非 object / 缺 events → invalid(broken_wire)", () => {
    assert.equal(assessEventsConfigWire(null).status, "invalid");
    assert.equal(
      assessEventsConfigWire(null).status === "invalid"
        ? assessEventsConfigWire(null).code
        : null,
      "broken_wire",
    );

    const missingEvents = { schemaVersion: 2 };
    const health = assessEventsConfigWire(missingEvents);
    assert.equal(health.status, "invalid");
    if (health.status === "invalid") {
      assert.equal(health.code, "broken_wire");
    }
  });
});

describe("assessAgentDefinitionWire", () => {
  it("T-A1: prompts.blocks agent wire → invalid(removed_feature)", () => {
    const wire = {
      schemaVersion: 1,
      name: "legacy",
      prompts: { blocks: {} },
    };
    const health = assessAgentDefinitionWire(wire);
    assert.equal(health.status, "invalid");
    if (health.status === "invalid") {
      assert.equal(health.code, "removed_feature");
      assert.match(health.message, /prompts\.blocks/);
    }
  });

  it("T-A2: 合法 agent v1 → valid", () => {
    const wire = {
      schemaVersion: 1,
      name: "writer",
      prompts: {
        system: "hi",
        persist: {},
        dynamic: {},
      },
      runtime: { maxSteps: 5 },
    };
    const health = assessAgentDefinitionWire(wire);
    assert.equal(health.status, "valid");
    if (health.status === "valid") {
      assert.equal(health.value.name, "writer");
      assert.equal(health.value.runtime?.maxSteps, 5);
    }
  });
});

describe("buildDefaultAgentDefinitionPreservingName", () => {
  it("T-A3: 保留 name、默认 prompts 与 maxSteps", () => {
    const def = buildDefaultAgentDefinitionPreservingName("  我的 Agent  ");
    assert.equal(def.name, "我的 Agent");
    assert.deepEqual(def.prompts, layoutFromFormInput(createDefaultAgentEditorPrompts()));
    assert.deepEqual(def.runtime, { maxSteps: 20 });
    assert.doesNotThrow(() => {
      decode(encode(def, agentDefinitionSchema), agentDefinitionSchema);
    });
  });
});

describe("STORED_CONFIG_LABELS", () => {
  it("提供失效面板主文案", () => {
    assert.equal(STORED_CONFIG_LABELS.invalidTitle, "配置已失效");
    assert.equal(STORED_CONFIG_LABELS.eventsRestoreAndSave, "恢复默认并保存");
    assert.equal(STORED_CONFIG_LABELS.agentOverwriteDefault, "用默认模板覆盖并保存");
  });
});

novelMasterTestFixture();

describe("getRawWire + assess 集成", () => {
  it("SqliteAgentDefinitionRepository.getRawWire 不解码，可 assess", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteAgentDefinitionRepository(ctx.conn);
    const legacyWire = {
      schemaVersion: 1,
      name: "broken",
      prompts: { blocks: {} },
    };
    const now = Date.now();
    await ctx.conn.execute(
      `INSERT INTO agent_definition (agent_id, prompts_json, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?)`,
      ["legacy-agent", JSON.stringify(legacyWire), now, now],
    );

    const raw = await repo.getRawWire("legacy-agent");
    assert.deepEqual(raw, legacyWire);

    const health = assessAgentDefinitionWire(raw);
    assert.equal(health.status, "invalid");
    assert.equal(await repo.getRawWire("missing"), null);
  });

  it("DefaultEventsConfigStore.assessStored：无配置为 valid 默认", async () => {
    const store = new DefaultEventsConfigStore({
      async listKeys() {
        return [];
      },
      async get(module, key) {
        throw kkvNotFound(module, key);
      },
      async set() {},
      async delete() {},
    });

    const health = await store.assessStored();
    assert.equal(health.status, "valid");
    if (health.status === "valid") {
      assert.equal(health.value.schemaVersion, 2);
    }
  });

  it("DefaultEventsConfigStore.assessStored：v1 wire 为 invalid", async () => {
    const store = new DefaultEventsConfigStore({
      async listKeys() {
        return [];
      },
      async get() {
        return JSON.stringify({ schemaVersion: 1, events: {} });
      },
      async set() {},
      async delete() {},
    });

    const health = await store.assessStored();
    assert.equal(health.status, "invalid");
    if (health.status === "invalid") {
      assert.equal(health.code, "outdated_version");
    }
  });
});
