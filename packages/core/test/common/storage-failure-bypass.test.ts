/**
 * C1-6 I5（双向，有牙）：YAML 导入通道的错误标签反转判据。
 *
 * ①DB 故障不被贴「YAML 无效」标签；②YAML 语法错 / schema 违规**仍**贴「YAML 无效」。
 * ②是反转判据的牙齿——按旧的正向白名单实现时它必红。
 *
 * 纯函数级，不起 Electron / RN：直接对 `normalizeYamlError` 与 `isStorageFailure`
 * 两个纯函数做断言（两侧 app 通道的 catch 里就是这一对组合）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseText, TdbcError } from "@novel-master/core";
import { decodeSmartSortRuleBundle } from "@novel-master/core/smart-sort-rule";
import { isStorageFailure, normalizeYamlError } from "../../src/common/index.js";

describe("YAML 导入通道的错误标签反转判据", () => {
  it("T-SRTX-D1 DB 故障不被贴「YAML 无效」标签", () => {
    const dbFailure = new TdbcError("SQLITE_ERROR", "SQLITE_CONSTRAINT: 撞号");
    assert.equal(isStorageFailure(dbFailure), true, "TdbcError 必须判为存储类");
    // 通道语义：命中即原样上抛，不经 normalizeYamlError。
    const surfaced = isStorageFailure(dbFailure)
      ? dbFailure
      : normalizeYamlError(dbFailure, "智能排序规则 YAML 无效");
    assert.equal(
      surfaced.message.includes("YAML 无效"),
      false,
      "DB 故障不得带上「YAML 无效」标签",
    );
  });

  it("T-SRTX-D2 YAML 语法错 / schema 违规仍贴「YAML 无效」标签", () => {
    // YAML 语法错。
    let syntaxErr: unknown;
    try {
      parseText("rules: [", "yaml");
    } catch (e) {
      syntaxErr = e;
    }
    assert.ok(syntaxErr != null, "夹具必须真的抛（否则本条无牙齿）");
    assert.equal(isStorageFailure(syntaxErr), false, "语法错不得判为存储类");
    assert.match(
      normalizeYamlError(syntaxErr, "智能排序规则 YAML 无效").message,
      /YAML 无效/,
    );

    // schema 违规（缺 rules 字段）。
    let schemaErr: unknown;
    try {
      decodeSmartSortRuleBundle({ nope: 1 });
    } catch (e) {
      schemaErr = e;
    }
    assert.ok(schemaErr != null, "夹具必须真的抛");
    assert.equal(isStorageFailure(schemaErr), false, "schema 错不得判为存储类");
    assert.match(
      normalizeYamlError(schemaErr, "智能排序规则 YAML 无效").message,
      /YAML 无效/,
    );
  });
});