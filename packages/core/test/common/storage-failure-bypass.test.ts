/**
 * C1-6 I5（双向，有牙）+ c1 P2-6：YAML 导入通道的错误标签反转判据。
 *
 * ①DB 故障不被贴「YAML 无效」标签；②YAML 语法错 / schema 违规**仍**贴「YAML 无效」。
 * ②是反转判据的牙齿——按旧的正向白名单实现时它必红。
 *
 * 纯函数级，不起 Electron / RN。
 *
 * ⚠️ **c1 P2-6：这里测的是 `normalizeSmartSortImportError` 本身，不是「重演」一遍
 * 判据**。此前本文件断言的是 `isStorageFailure` 与 `normalizeYamlError` 两个纯函数
 * 各自的行为，两端 app catch 里那对三元的组合是**测试里抄的一份**——谁把
 * `apps/mobile/.../smart-sort-rule-yaml.service.ts`（或 desktop 那份）的
 * `if (isStorageFailure(error)) throw error;` 删掉，本文件照样全绿，而它守的恰恰是
 * C1-6 I5 的一半（DB 故障误报成「YAML 无效」）。
 * 现在两端 app 调的是同一个 core 函数（desktop + mobile 两份字面量已收敛成一处），
 * 本文件直接测它 ⇒ 测的**就是**真正被执行的那段逻辑，任一端把它换成不绕过的实现
 * 就会红（接线牙齿）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseText, TdbcError } from "@novel-master/core";
import { decodeSmartSortRuleBundle } from "@novel-master/core/smart-sort-rule";
import {
  isStorageFailure,
  normalizeSmartSortImportError,
  SMART_SORT_IMPORT_YAML_INVALID_LABEL,
} from "../../src/common/index.js";

describe("YAML 导入通道的错误标签反转判据（normalizeSmartSortImportError）", () => {
  it("T-SRTX-D1 DB 故障不被贴「YAML 无效」标签", () => {
    const dbFailure = new TdbcError("SQLITE_ERROR", "SQLITE_CONSTRAINT: 撞号");
    assert.equal(isStorageFailure(dbFailure), true, "TdbcError 必须判为存储类");

    // 通道语义：命中即原样上抛，不经 normalizeYamlError。
    const surfaced = normalizeSmartSortImportError(dbFailure);
    assert.equal(surfaced.message.includes("YAML 无效"), false,
      "DB 故障不得带上「YAML 无效」标签");
    // 且必须是**原对象**：端上 `throw` 出去后调用方要能按 TdbcError 拿到 code，
    // 包一层新 Error 会把 code 丢掉（端上错误分类依赖它）。
    assert.equal(surfaced, dbFailure,
      "存储类故障必须原样返回（不得包装），否则端上拿不到 TdbcError.code");
    assert.equal((surfaced as TdbcError).code, "SQLITE_ERROR",
      "原样返回 ⇒ code 仍在（这条守住「不包装」）");
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
      normalizeSmartSortImportError(syntaxErr).message,
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
      normalizeSmartSortImportError(schemaErr).message,
      /YAML 无效/,
    );
  });

  /**
   * 接线牙齿的补充：判据一旦被写成**正向白名单**（只让列举到的错误绕过），
   * 未列举的普通 Error 会被误判成 DB 类 ⇒「YAML 无效」标签从主路径消失。
   * 本条钉住「非 Error 的抛出值也照套前缀」（反转判据的兜底边界）。
   */
  it("T-SRTX-D3 非 Error 抛出值照套前缀（不因判据放宽而漏标签）", () => {
    const thrown: unknown = "裸字符串";
    assert.equal(isStorageFailure(thrown), false);
    const surfaced = normalizeSmartSortImportError(thrown);
    assert.match(surfaced.message, /YAML 无效/);
    // normalizeYamlError 对非 Error 只给 fallback 本身，不拼 ": undefined"
    assert.equal(surfaced.message, SMART_SORT_IMPORT_YAML_INVALID_LABEL);
  });
});