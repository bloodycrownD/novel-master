import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError, firstDescriptorOf, isAppError, toSnakeCase, type ErrorParamsMap } from "../../src/errors/app-error.js";
import { ErrorCodes } from "../../src/errors/error-codes.js";
import { CORE_MESSAGE_KEYS, type CoreMessageKey } from "../../src/i18n/keys.js";
import { CORE_CATALOGS } from "../../src/i18n/generated-catalog.js";

/** 各域保留号段；新增域时先在这里登记，守卫会强制 code 落在段内。 */
const DOMAIN_RANGES: Record<string, readonly [number, number]> = {
  AGENT: [101000, 101999],
  VFS: [102000, 102999],
  VFS_CHARACTER_CARD: [103000, 103999],
  TOOL: [104000, 104999],
  PROVIDER: [105000, 105999],
  CHAT: [106000, 106999],
  SKILL: [107000, 107999],
  COMPACTION_CONDITIONS: [108000, 108499],
  SMART_SORT_RULE: [108500, 108999],
  CONFIG: [109000, 109499],
  PREFERENCES: [109500, 109999],
  INFRA: [110000, 110999],
  DEPTH: [111000, 111999],
  EVENTS: [112000, 112999],
  FEATURE_FLAGS: [113000, 113999],
  FORMAT: [114000, 114999],
  KKV: [115000, 115999],
  SESSION_FS: [116000, 116999],
  PROMPT: [117000, 117999],
  SESSION_KKV: [118000, 118999],
  SESSION_RUN_STATE: [119000, 119999],
  USAGE: [120000, 120999],
  WORKPLACE: [121000, 121999],
  IPC: [123000, 123999],
};

/** 取 key 的域：最长已登记前缀 + `_`，覆盖 VFS_CHARACTER_CARD / SMART_SORT_RULE / SESSION_FS 等多段 token；TASK_* 控制流码落在 IPC 段。 */
function domainOf(key: string): string {
  if (key.startsWith("TASK_")) {
    return "IPC";
  }
  const matched = Object.keys(DOMAIN_RANGES)
    .sort((a, b) => b.length - a.length)
    .find((domain) => key.startsWith(`${domain}_`));
  return matched ?? key.split("_")[0]!;
}

/** 与 ErrorParamsMap 手工对齐的字段清单（带 ? 尾缀 = 可选）；漂移由下面的占位符守卫与 T-K2 编译期断言抓。 */
const PARAM_FIELDS: Partial<Record<keyof ErrorParamsMap, readonly string[]>> = {
  AGENT_NOT_FOUND: ["agentId"],
  AGENT_INVALID_MODEL: ["modelId?"],
  VFS_NOT_FOUND: ["path"],
  VFS_REPLACE_NOT_FOUND: ["path", "oldStringLength", "longestCommonSubstring", "lcsLength", "lcsOccurrences", "oldStringPreview?", "fileHintPreview?"],
  VFS_DIRECTORY_NOT_EMPTY: ["path"],
  VFS_INVALID_PATH: ["path", "reason?"],
  VFS_INVALID_NAME: ["path", "reason?"],
  VFS_IS_DIRECTORY: ["path"],
  VFS_ALREADY_EXISTS: ["path"],
  VFS_NOT_A_DIRECTORY: ["path"],
  VFS_PARENT_NOT_FOUND: ["path"],
  VFS_INVALID_PATTERN: ["pattern"],
  VFS_CHARACTER_CARD_UNSUPPORTED_SPEC: ["spec"],
  TOOL_SEARCH_TEMPLATE_INVALID: ["reason"],
  TOOL_NOT_FOUND: ["toolName"],
  TOOL_CONFLICT: ["toolName"],
  TOOL_INVALID_ARGUMENT: ["toolName", "issues"],
  TOOL_FAILED: ["toolName", "cause?"],
  TOOL_FORBIDDEN: ["toolName", "path"],
  PROVIDER_NOT_FOUND: ["providerId"],
  PROVIDER_SAVED_MODEL_IN_USE: ["modelName", "blockingRefs"],
  CHAT_NOT_FOUND: ["kind", "id", "messageId?", "projectId?", "sessionId?"],
  SKILL_INVALID_NAME: ["skillName", "reason"],
  SKILL_INVALID_PATH: ["path", "reason?"],
  SKILL_MISSING_DOMAIN: ["skillName"],
  SKILL_MISSING_PROJECT_ID: ["skillName"],
  SKILL_NOT_FOUND: ["skillName", "path?"],
  SKILL_BUILTIN: ["skillName"],
  SKILL_BUILTIN_NAME_RESERVED: ["skillName"],
  SKILL_BUILTIN_RENAME: ["skillName"],
  SKILL_ALREADY_EXISTS: ["skillName"],
  SESSION_FS_ROLLBACK_MESSAGE_NOT_FOUND: ["messageId", "sessionId?", "logicalPath?"],
  SESSION_FS_ROLLBACK_MESSAGE_SESSION_MISMATCH: ["messageId", "sessionId?"],
  SESSION_FS_RESTORE_REVISION_MISSING: ["logicalPath", "revisionVersion", "sessionId?", "messageId?"],
  SESSION_FS_ROLLBACK_NO_CHECKPOINT: ["messageId?", "sessionId?"],
  SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED: ["sessionId?", "messageId?", "logicalPath?"],
  SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED: ["missingLogicalPaths", "sessionId?", "messageId?"],
  SESSION_FS_ROLLBACK_CONFLICT: ["expectedMessageCount", "actualMessageCount", "sessionId?", "messageId?"],
  SESSION_FS_ROLLBACK_TAIL_DRIFT: ["expectedMessageCount", "actualMessageCount", "sessionId?", "messageId?"],
  PROMPT_INVALID_YAML: ["offset?"],
  PROMPT_INVALID_BLOCK: ["offset?"],
  PROMPT_UNKNOWN_FIELD: ["offset?"],
  PROMPT_UNSUPPORTED_SYNTAX: ["offset?"],
  KKV_NOT_FOUND: ["module", "key"],
  PREFERENCES_INVALID_VALUE: ["key", "expectedType", "actualValue"],
};

/** 本期（error-channel-migration 一期 Step 2）新增的 messageKey；en-US 必须全覆盖（既有缺口不在此列）。 */
const PHASE_NEW_MESSAGE_KEYS = [
  "error.chat.not_found",
  "error.skill.not_found",
  "error.vfs.zip_not_confirmed",
  "error.vfs.zip_external_not_supported",
  "error.tool.not_found",
  "error.tool.conflict",
  "error.tool.failed",
  "error.tool.forbidden",
  "error.provider.not_found",
  "error.provider.conflict",
  "error.provider.builtin_provider",
  "error.provider.http_error",
  "error.provider.model_not_saved",
  "error.provider.unsupported_content",
  "error.provider.unsupported",
  "error.provider.malformed_sse",
  "error.provider.invalid_tool_arguments",
  "error.provider.migration_orphan_pointer",
  "error.provider.invalid_model_name",
  "error.session_fs.rollback_no_checkpoint",
  "error.infra.decode_invalid_schema",
  "error.infra.encode_not_supported",
  "error.prompt.invalid_yaml",
  "error.prompt.invalid_block",
  "error.prompt.unknown_field",
  "error.prompt.unsupported_syntax",
] as const;

function paramsOf(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
}

function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

describe("ErrorCodes 注册表", () => {
  it("code 是正整数且落在所属域段内", () => {
    for (const [key, { code }] of Object.entries(ErrorCodes)) {
      assert.ok(Number.isInteger(code) && code > 0, `${key} 的 code 必须是正整数`);
      const domain = domainOf(key);
      const range = DOMAIN_RANGES[domain];
      assert.ok(range, `${key} 的域 ${domain} 还没登记号段`);
      assert.ok(code >= range[0] && code <= range[1], `${key} 的 code ${code} 超出 ${domain} 段 ${range[0]}-${range[1]}`);
    }
  });

  it("数字码全局唯一（发布后严禁复用或改号）", () => {
    const seen = new Map<number, string>();
    for (const [key, { code }] of Object.entries(ErrorCodes)) {
      const owner = seen.get(code);
      assert.equal(owner, undefined, `code ${code} 被 ${owner} 和 ${key} 重复占用`);
      seen.set(code, key);
    }
  });

  it("desc 非空", () => {
    for (const [key, { desc }] of Object.entries(ErrorCodes)) {
      assert.ok(desc.trim().length > 0, `${key} 缺少 desc`);
    }
  });
});

describe("ErrorCodes messageKey 三处同步（T-K1）", () => {
  const zhCn = CORE_CATALOGS["zh-CN"]!;
  const enUs = CORE_CATALOGS["en-US"]!;

  it("每条 messageKey ∈ CORE_MESSAGE_KEYS（封闭联合）且 zh-CN 全量覆盖", () => {
    const known = new Set<string>(CORE_MESSAGE_KEYS);
    for (const [key, { messageKey }] of Object.entries(ErrorCodes)) {
      if (messageKey == null) continue;
      assert.ok(known.has(messageKey), `${key} 的 messageKey ${messageKey} 未登记进 CORE_MESSAGE_KEYS`);
      assert.ok(messageKey in zhCn, `${messageKey} 缺 zh-CN 条目`);
    }
  });

  it("本期新增 messageKey 在 en-US 全覆盖，且与 zh-CN 占位符集合一致", () => {
    const newKeys = new Set<string>(PHASE_NEW_MESSAGE_KEYS);
    for (const messageKey of PHASE_NEW_MESSAGE_KEYS) {
      assert.ok(messageKey in enUs, `本期新增 key ${messageKey} 缺 en-US 条目`);
    }
    for (const [name, template] of Object.entries(enUs)) {
      if (!newKeys.has(name)) continue;
      assert.deepEqual(paramsOf(template as string), paramsOf(zhCn[name as CoreMessageKey] as string), `占位符集合不一致：${name}`);
    }
  });

  it("每条 messageKey 的模板占位符 ⊆ 该 key 的 snake_case 字段名集合（缺参即字面量，必红）", () => {
    for (const [key, { messageKey }] of Object.entries(ErrorCodes)) {
      if (messageKey == null) continue;
      const fields = PARAM_FIELDS[key as keyof ErrorParamsMap] ?? [];
      const snakeFields = new Set([...fields.map((field) => toSnake(field.replaceAll("?", ""))), "detail", "descriptor"]);
      for (const placeholder of paramsOf(zhCn[messageKey] as string)) {
        assert.ok(snakeFields.has(placeholder), `${key} → ${messageKey} 的占位符 {${placeholder}} 不在 ErrorParamsMap 字段（snake_case）内`);
      }
    }
  });
});

describe("AppError", () => {
  it("key 映射到注册表的 code/desc，message 缺省时用 desc 兜底", () => {
    const error = new AppError("AGENT_DOOM_LOOP");
    assert.equal(error.name, "AGENT_DOOM_LOOP");
    assert.equal(error.key, "AGENT_DOOM_LOOP");
    assert.equal(error.code, ErrorCodes.AGENT_DOOM_LOOP.code);
    assert.equal(error.desc, ErrorCodes.AGENT_DOOM_LOOP.desc);
    assert.equal(error.message, ErrorCodes.AGENT_DOOM_LOOP.desc);
  });

  it("保留运行期 message、details 与 cause（旧签名过渡期行为不变）", () => {
    const cause = new Error("boom");
    const error = new AppError(
      "AGENT_DOOM_LOOP",
      'Doom loop: tool "read" invoked 3 times with identical input',
      { toolName: "read" },
      { cause }
    );
    assert.equal(error.message, 'Doom loop: tool "read" invoked 3 times with identical input');
    assert.deepEqual(error.details, { toolName: "read" });
    assert.equal(error.cause, cause);
    assert.equal(error.messageKey, undefined);
  });

  it("toJSON 输出跨进程形状", () => {
    const error = new AppError("AGENT_DOOM_LOOP", "boom", { traceId: "t1" });
    assert.deepEqual(error.toJSON(), {
      key: "AGENT_DOOM_LOOP",
      code: ErrorCodes.AGENT_DOOM_LOOP.code,
      desc: ErrorCodes.AGENT_DOOM_LOOP.desc,
      message: "boom",
      details: { traceId: "t1" },
    });
  });

  it("isAppError 收窄实例，并可按 key 校验", () => {
    const error = new AppError("AGENT_DOOM_LOOP");
    assert.equal(isAppError(error), true);
    assert.equal(isAppError(error, "AGENT_DOOM_LOOP"), true);
    assert.equal(isAppError(new Error("x")), false);
  });

  it("新签名：message 取 params.detail，缺省回退 desc；details 即 params 原样", () => {
    const error = new AppError("CHAT_NOT_FOUND", { kind: "message", id: "m1", detail: "message not found: m1" });
    assert.equal(error.message, "message not found: m1");
    assert.equal(error.key, "CHAT_NOT_FOUND");
    assert.deepEqual(error.details, { kind: "message", id: "m1", detail: "message not found: m1" });
    const fallback = new AppError("CHAT_NOT_FOUND", { kind: "session", id: "s1" });
    assert.equal(fallback.message, ErrorCodes.CHAT_NOT_FOUND.desc);
  });

  it("新签名：messageKey 取码表缺省模板，messageParams 转 snake_case", () => {
    const error = new AppError("TOOL_NOT_FOUND", { toolName: "read" });
    assert.equal(error.messageKey, "error.tool.not_found");
    assert.deepEqual(error.messageParams, { tool_name: "read" });
    // 码表无 messageKey 的码不产出 i18n 通道。
    const plain = new AppError("CHAT_INVALID_ARGUMENT", { detail: "bad blocks" });
    assert.equal(plain.messageKey, undefined);
    assert.equal(plain.message, "bad blocks");
  });

  it("新签名：params.cause 双写（Error.cause 与 details.cause 都能拿到）", () => {
    const cause = new Error("vfs boom");
    const error = new AppError("TOOL_FAILED", { toolName: "read", cause });
    assert.equal(error.cause, cause);
    assert.equal((error.details as { cause?: unknown }).cause, cause);
  });

  it("新签名：descriptor 成员接管 messageKey，params 原样落 details（T-K2 detail 通道）", () => {
    const error = new AppError("SKILL_NOT_FOUND", {
      skillName: "alpha",
      descriptor: { key: "error.skill.not_found_in_domain", params: { name: "alpha", domain: "global", path: "SKILL.md", hint: { key: "error.skill.not_found_in_domain_hint.create", params: { domain: "global" } } } },
    });
    assert.equal(error.messageKey, "error.skill.not_found_in_domain");
    assert.deepEqual(error.messageParams, { name: "alpha", domain: "global", path: "SKILL.md", hint: { key: "error.skill.not_found_in_domain_hint.create", params: { domain: "global" } } });
    assert.equal(error.message, ErrorCodes.SKILL_NOT_FOUND.desc);
    new AppError("SKILL_NOT_FOUND", { skillName: "alpha", detail: "dynamic copy" });
    // @ts-expect-error 未登记的参数名必须编译期报错（T-K2）
    new AppError("CHAT_NOT_FOUND", { kind: "session", id: "s1", bogusField: 1 });
    // @ts-expect-error 缺 message 组装必需项必须编译期报错（T-K2）
    new AppError("CHAT_NOT_FOUND", { kind: "session" });
  });

  it("旧签名：descriptor 通道行为不变（messageKey/messageParams 来自 descriptor，details 原样）", () => {
    const error = new AppError(
      "SESSION_FS_RESTORE_REVISION_MISSING",
      { key: "error.session_fs.restore_revision_missing", params: { logical_path: "/docs/a.md", revision_version: 3 } },
      { logicalPath: "/docs/a.md", revisionVersion: 3 }
    );
    assert.equal(error.messageKey, "error.session_fs.restore_revision_missing");
    assert.deepEqual(error.messageParams, { logical_path: "/docs/a.md", revision_version: 3 });
    assert.equal(error.message, ErrorCodes.SESSION_FS_RESTORE_REVISION_MISSING.desc);
    assert.deepEqual(error.details, { logicalPath: "/docs/a.md", revisionVersion: 3 });
  });

  it("旧签名：字符串 message 不从 details 捡 descriptor；带码表模板时 messageParams 含 detail 与字段", () => {
    const error = new AppError("AGENT_NOT_FOUND", "agent not found: ag-1", { agentId: "ag-1" });
    assert.equal(error.message, "agent not found: ag-1");
    assert.equal(error.messageKey, "error.agent.not_found");
    assert.deepEqual(error.messageParams, { detail: "agent not found: ag-1", agent_id: "ag-1" });
    assert.deepEqual(error.details, { agentId: "ag-1" });
    // details 里 descriptor 形状的成员不改变字符串通道。
    const withShaped = new AppError("AGENT_DOOM_LOOP", "loop", { payload: { key: "error.agent.not_found" } });
    assert.equal(withShaped.messageKey, undefined);
  });

  it("firstDescriptorOf 契约：descriptor 成员优先，其次第一个 descriptor 形状的顶层成员", () => {
    const descriptor = { key: "error.chat.not_found" as const };
    assert.equal(firstDescriptorOf(undefined), undefined);
    assert.equal(firstDescriptorOf({}), undefined);
    assert.equal(firstDescriptorOf({ kind: "message", id: "1" }), undefined);
    assert.equal(firstDescriptorOf({ kind: "message", descriptor }), descriptor);
    assert.equal(firstDescriptorOf({ nested: descriptor, other: 1 }), descriptor);
    assert.equal(firstDescriptorOf({ key: "not-a-descriptor" }), undefined);
  });

  it("toSnakeCase：顶层成员名 camelCase → snake_case，值原样透传", () => {
    assert.deepEqual(toSnakeCase({ toolName: "read", already_snake: 1, nested: { innerKey: 2 } }), { tool_name: "read", already_snake: 1, nested: { innerKey: 2 } });
  });

  it("T-M1: PromptError 4 码退役映射——offset 进 params，detail 覆盖动态文案", () => {
    const yaml = new AppError("PROMPT_INVALID_YAML", { detail: "unclosed macro comment", offset: 12 });
    assert.equal(yaml.code, 117004);
    assert.equal(yaml.message, "unclosed macro comment");
    assert.deepEqual(yaml.details, { detail: "unclosed macro comment", offset: 12 });
    assert.deepEqual(yaml.messageParams, { detail: "unclosed macro comment", offset: 12 });
    assert.equal(yaml.messageKey, "error.prompt.invalid_yaml");
    assert.equal(new AppError("PROMPT_INVALID_BLOCK").code, 117005);
    const unknownField = new AppError("PROMPT_UNKNOWN_FIELD", { detail: "unknown field: .a.b", offset: 3 });
    assert.equal(unknownField.code, 117006);
    assert.equal(unknownField.messageKey, "error.prompt.unknown_field");
    assert.equal(isAppError(unknownField, "PROMPT_UNKNOWN_FIELD"), true);
    const syntax = new AppError("PROMPT_UNSUPPORTED_SYNTAX", { detail: "unsupported syntax near offset 7", offset: 7 });
    assert.equal(syntax.code, 117007);
    assert.equal(syntax.messageKey, "error.prompt.unsupported_syntax");
  });

  it("T-M2: ConfigDecodeError 2 码退役映射", () => {
    const schema = new AppError("CONFIG_DECODE_INVALID_SCHEMA", { detail: "invalid JSON" });
    assert.equal(schema.code, 109001);
    assert.equal(schema.message, "invalid JSON");
    assert.equal(schema.messageKey, "error.infra.decode_invalid_schema");
    const encodeUnsupported = new AppError("CONFIG_DECODE_ENCODE_NOT_SUPPORTED", { detail: "schema does not define toWire" });
    assert.equal(encodeUnsupported.code, 109002);
    assert.equal(encodeUnsupported.messageKey, "error.infra.encode_not_supported");
  });
});
