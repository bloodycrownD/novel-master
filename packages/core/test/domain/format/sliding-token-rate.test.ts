import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTokenRateSampler,
  slidingTokenRate,
} from "../../../src/domain/format/sliding-token-rate.js";

describe("slidingTokenRate（T-M9 滑窗速率）", () => {
  it("200 t/s 场景数值稳定：窗口推进下每个时刻的速率都在 200 附近", () => {
    // 每 250ms 产出 50 t（=200 t/s），采样 4s。逐时刻只用「截至该时刻」
    // 的样本切片（真实组件的样本序列不含未来样本）。
    const samples: {tMs: number; tokens: number}[] = [];
    const startMs = 100_000;
    for (let i = 1; i <= 16; i += 1) {
      samples.push({tMs: startMs + i * 250, tokens: i * 50});
    }
    // 窗口填满后（≥2.5s）逐时刻核对：首尾差分 ÷ 窗口时长 ≈ 200。
    for (let i = 10; i <= 16; i += 1) {
      const nowMs = startMs + i * 250;
      const rate = slidingTokenRate(samples.slice(0, i), nowMs);
      assert.notEqual(rate, null);
      assert.ok(
        Math.abs(rate! - 200) <= 8,
        `t=${i} 时刻速率 ${rate} 应稳定在 200 附近`
      );
    }
  });

  it("5 t/s 慢速流数值稳定（时间窗口制：delta 稀疏不冻结显示）", () => {
    // 每 200ms 产出 1 t（=5 t/s），采样 4s。
    const samples: {tMs: number; tokens: number}[] = [];
    const startMs = 100_000;
    for (let i = 1; i <= 20; i += 1) {
      samples.push({tMs: startMs + i * 200, tokens: i});
    }
    for (let i = 14; i <= 20; i += 1) {
      const nowMs = startMs + i * 200;
      const rate = slidingTokenRate(samples.slice(0, i), nowMs);
      assert.notEqual(rate, null);
      assert.ok(
        Math.abs(rate! - 5) <= 0.4,
        `t=${i} 时刻速率 ${rate} 应稳定在 5 附近`
      );
    }
  });

  it("输出暂停 3s 后速率衰减趋零；恢复后回升", () => {
    const sampler = createTokenRateSampler();
    const startMs = 100_000;
    // 先以 200 t/s 跑 1.5s（每 250ms +50）。
    for (let i = 1; i <= 6; i += 1) {
      sampler.sample(i * 50, "usage", startMs + i * 250);
    }
    const beforePause = sampler.sample(350, "usage", startMs + 1_500);
    assert.ok(beforePause != null && beforePause > 150);

    // 暂停 3s：tokens 不变、只有时刻推进（采样器不记重复值样本）。
    const at3s = sampler.sample(350, "usage", startMs + 4_500);
    assert.ok(
      at3s != null && at3s < beforePause! * 0.5,
      `暂停 3s 后速率 ${at3s} 应大幅衰减`
    );
    // 继续暂停到出窗：窗口内无可差分样本，速率归零。
    const at4s = sampler.sample(350, "usage", startMs + 5_600);
    assert.equal(at4s, 0);

    // 恢复 200 t/s：1s 后速率回升到 100+。
    for (let i = 1; i <= 4; i += 1) {
      sampler.sample(350 + i * 50, "usage", startMs + 5_600 + i * 250);
    }
    const recovered = sampler.sample(550, "usage", startMs + 6_600);
    assert.ok(
      recovered != null && recovered > 100,
      `恢复后速率 ${recovered} 应回升`
    );
  });

  it("样本不足两个或时长非正返回 null（省略速率段的判定依据）", () => {
    assert.equal(slidingTokenRate([], 1_000), null);
    assert.equal(slidingTokenRate([{tMs: 900, tokens: 5}], 1_000), null);
    // 全部样本晚于当前时刻（时钟回拨形态）：时长非正 → null。
    assert.equal(
      slidingTokenRate(
        [
          {tMs: 2_000, tokens: 5},
          {tMs: 2_500, tokens: 9},
        ],
        1_000
      ),
      null
    );
  });
});

describe("createTokenRateSampler（T-M10 校正重置）", () => {
  it("heuristic→usage 覆盖瞬间滑窗重 seed、速率无尖刺", () => {
    const sampler = createTokenRateSampler();
    const startMs = 100_000;
    // heuristic 阶段：每 250ms 折算 +3 t（约 12 t/s）。
    for (let i = 1; i <= 8; i += 1) {
      sampler.sample(i * 3, "heuristic", startMs + i * 250);
    }
    const heuristicRate = sampler.sample(24, "heuristic", startMs + 2_000);
    assert.ok(heuristicRate != null && heuristicRate < 20);

    // usage 校正：真值瞬间跳到 900（中文低估约半的典型幅度）。
    // 重 seed 后窗口只有 1 个样本 → null（显示省略速率段，无尖刺数字）。
    const atCorrection = sampler.sample(900, "usage", startMs + 2_050);
    assert.equal(atCorrection, null, "校正瞬间不应产出尖刺速率");

    // 校正后从真值起算：窗口重新填满前速率平滑（900→915 in 250ms = 60 t/s）。
    for (let i = 1; i <= 8; i += 1) {
      sampler.sample(900 + i * 15, "usage", startMs + 2_050 + i * 250);
    }
    const postRate = sampler.sample(1_020, "usage", startMs + 4_050);
    assert.ok(
      postRate != null && Math.abs(postRate - 60) <= 5,
      `校正后速率 ${postRate} 应从真值起算（≈60）而非被跳变污染`
    );
  });

  it("reset 后跨 run 差分不残留", () => {
    const sampler = createTokenRateSampler();
    sampler.sample(5_000, "usage", 100_000);
    sampler.reset();
    // 新 run 从零起：首个样本即 seed，速率 null。
    assert.equal(sampler.sample(3, "usage", 200_000), null);
    assert.equal(sampler.sample(6, "usage", 200_250), 12);
  });

  it("tokens 未变的重复采样不产生新样本（暂停衰减依赖 nowMs 分母）", () => {
    const sampler = createTokenRateSampler();
    sampler.sample(100, "usage", 100_000);
    sampler.sample(200, "usage", 100_250);
    // 同 tokens、只推进时刻：分子不变分母增大，速率下降。
    const r1 = sampler.sample(200, "usage", 100_500);
    const r2 = sampler.sample(200, "usage", 101_000);
    assert.ok(r1 != null && r2 != null && r2 < r1);
  });
});
