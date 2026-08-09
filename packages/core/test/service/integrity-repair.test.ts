/**
 * IntegrityRepairRegistry / runIntegrityRepair 单元测试（S-8 / Step 20）。
 *
 * 覆盖：
 * - register 校验（detect/repair 必填、重名拒绝）；
 * - detect 只读、needsRepair=false 时跳过 repair；
 * - needsRepair=true 时跑 repair；
 * - detect 抛错时保守尝试 repair；
 * - repair 抛错挂到报告 error，不中断后续操作；
 * - runOnly 按种类过滤；
 * - runIntegrityRepair 便捷函数等价于 registry 单步。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IntegrityRepairRegistry,
  runIntegrityRepair,
  type IntegrityRepairOperation,
} from "@/service/integrity-repair.js";

/** 拼一个可控行为的假操作，方便断言 detect/repair 是否被调用。 */
function fakeOp(
  name: string,
  opts: {
    readonly kind?: "repair" | "rename" | "backfill";
    readonly needsRepair?: boolean;
    readonly details?: string;
    readonly detectThrows?: Error;
    readonly repairThrows?: Error;
  } = {},
): IntegrityRepairOperation & {
  detectCalls: number;
  repairCalls: number;
} {
  let detectCalls = 0;
  let repairCalls = 0;
  return {
    name,
    kind: opts.kind ?? "repair",
    async detect() {
      detectCalls++;
      if (opts.detectThrows) throw opts.detectThrows;
      return {
        needsRepair: opts.needsRepair ?? false,
        details: opts.details,
      };
    },
    async repair() {
      repairCalls++;
      if (opts.repairThrows) throw opts.repairThrows;
    },
    get detectCalls() {
      return detectCalls;
    },
    get repairCalls() {
      return repairCalls;
    },
  } as IntegrityRepairOperation & {
    detectCalls: number;
    repairCalls: number;
  };
}

describe("IntegrityRepairRegistry", () => {
  it("register 校验 detect/repair 必填且拒绝重名", () => {
    const registry = new IntegrityRepairRegistry();
    assert.throws(
      () =>
        registry.register({
          name: "x",
          kind: "repair",
          // @ts-expect-error 故意漏 detect
          detect: undefined,
          repair: async () => {},
        }),
      /detect/,
    );
    assert.throws(
      () =>
        registry.register({
          name: "x",
          kind: "repair",
          detect: async () => ({ needsRepair: false }),
          // @ts-expect-error 故意漏 repair
          repair: undefined,
        }),
      /repair/,
    );

    const a = fakeOp("a", { needsRepair: false });
    const aDup = fakeOp("a", { needsRepair: false });
    registry.register(a);
    assert.throws(() => registry.register(aDup), /已登记/);
  });

  it("needsRepair=false 时不跑 repair", async () => {
    const op = fakeOp("skip", { needsRepair: false });
    const registry = new IntegrityRepairRegistry().register(op);

    const reports = await registry.runAll();

    assert.equal(op.detectCalls, 1);
    assert.equal(op.repairCalls, 0);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.repaired, false);
    assert.equal(reports[0]!.detection.needsRepair, false);
  });

  it("needsRepair=true 时跑 repair", async () => {
    const op = fakeOp("fix", { needsRepair: true, details: "drift" });
    const registry = new IntegrityRepairRegistry().register(op);

    const reports = await registry.runAll();

    assert.equal(op.detectCalls, 1);
    assert.equal(op.repairCalls, 1);
    assert.equal(reports[0]!.repaired, true);
    assert.equal(reports[0]!.detection.details, "drift");
  });

  it("repair 抛错挂到报告 error，不中断后续操作", async () => {
    const boom = fakeOp("boom", {
      needsRepair: true,
      repairThrows: new Error("boom-repair"),
    });
    const ok = fakeOp("ok", { needsRepair: true });
    const registry = new IntegrityRepairRegistry().register(boom).register(ok);

    const reports = await registry.runAll();

    assert.equal(reports.length, 2);
    const boomReport = reports.find((r) => r.name === "boom")!;
    assert.equal(boomReport.repaired, false);
    assert.ok(boomReport.error instanceof Error);
    assert.equal((boomReport.error as Error).message, "boom-repair");
    const okReport = reports.find((r) => r.name === "ok")!;
    assert.equal(okReport.repaired, true);
    assert.equal(ok.error, undefined);
  });

  it("detect 抛错时保守尝试 repair 并在 details 记下错误", async () => {
    const op = fakeOp("detect-boom", {
      detectThrows: new Error("detect-exploded"),
    });
    const registry = new IntegrityRepairRegistry().register(op);

    const reports = await registry.runAll();

    assert.equal(op.detectCalls, 1);
    assert.equal(op.repairCalls, 1);
    assert.equal(reports[0]!.repaired, true);
    assert.match(
      reports[0]!.detection.details ?? "",
      /detect 阶段抛错.*detect-exploded/,
    );
  });

  it("runOnly 按种类过滤", async () => {
    const repair = fakeOp("r", { kind: "repair", needsRepair: true });
    const rename = fakeOp("n", { kind: "rename", needsRepair: true });
    const backfill = fakeOp("b", { kind: "backfill", needsRepair: true });
    const registry = new IntegrityRepairRegistry()
      .register(repair)
      .register(rename)
      .register(backfill);

    const reports = await registry.runOnly("rename");

    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.name, "n");
    assert.equal(rename.repairCalls, 1);
    assert.equal(repair.repairCalls, 0);
    assert.equal(backfill.repairCalls, 0);
  });

  it("detectAll 只返回需要修复的", async () => {
    const a = fakeOp("a", { needsRepair: false });
    const b = fakeOp("b", { needsRepair: true });
    const registry = new IntegrityRepairRegistry().register(a).register(b);

    const pending = await registry.detectAll();

    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.name, "b");
  });

  it("runIntegrityRepair 便捷函数等价于 registry 单步", async () => {
    const op = fakeOp("solo", { needsRepair: true });
    const report = await runIntegrityRepair(op);

    assert.equal(op.detectCalls, 1);
    assert.equal(op.repairCalls, 1);
    assert.equal(report.repaired, true);
    assert.equal(report.name, "solo");
  });

  it("空 registry runAll 返回空报告", async () => {
    const registry = new IntegrityRepairRegistry();
    const reports = await registry.runAll();
    assert.deepEqual(reports, []);
  });
});
