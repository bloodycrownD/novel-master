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

  it("未来样本（时钟回拨）不计入窗口，恢复后正常（core-metrics/B-4）", () => {
    const samples = [
      {tMs: 100_000, tokens: 0},
      {tMs: 100_250, tokens: 50},
      {tMs: 100_500, tokens: 100},
      {tMs: 100_750, tokens: 150},
    ];
    // 时钟回拨到 t=100_250：后两条是未来样本，须排除——只按 0→50 算 200 t/s。
    assert.equal(slidingTokenRate(samples, 100_250), 200);
    // 回拨到两样本之间：分母随 nowMs 走（50 t / 300ms），不被未来样本污染。
    const between = slidingTokenRate(samples, 100_300);
    assert.ok(
      between != null && Math.abs(between - 50_000 / 300) < 1e-9,
      `回拨到样本之间应只算已发生的增量：${between}`
    );
    // 回拨到首样本之前：无可用样本 → null（「全未来样本 → null」的推广）。
    assert.equal(slidingTokenRate(samples, 99_000), null);
    // 恢复：窗口按此刻重算，正常产出速率。
    assert.equal(slidingTokenRate(samples, 100_750), 200);
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

  it("usage 下调（900→600）与上调同构：翻转瞬间 null、从真值起算、freeze 回落（core-metrics/G-1）", () => {
    const sampler = createTokenRateSampler();
    const startMs = 100_000;
    // heuristic 阶段：每 250ms 折算 +3 t（约 12 t/s），累计 24。
    for (let i = 1; i <= 8; i += 1) {
      sampler.sample(i * 3, "heuristic", startMs + i * 250);
    }
    const heuristicTail = sampler.freeze();
    assert.ok(heuristicTail != null && heuristicTail > 0);

    // 真值低于累计估值（向下校正）：重 seed 后窗口只有 1 个样本 → null，
    // 不产负值、不产尖刺（与上调方向同构）。
    const atCorrection = sampler.sample(600, "usage", startMs + 2_050);
    assert.equal(atCorrection, null, "下调翻转瞬间不应产出速率");

    // 单样本：freeze 回落到翻转前末值（真值尺度尚未成窗口）。
    assert.equal(sampler.freeze(), heuristicTail);

    // 同源增长期：速率非负且从真值起算（600→615 in 250ms = 60 t/s）。
    const risen = sampler.sample(615, "usage", startMs + 2_300);
    assert.ok(
      risen != null && Number.isFinite(risen) && risen >= 0 && Math.abs(risen - 60) <= 1,
      `下调后速率应从真值起算（≈60）：${risen}`
    );
    assert.ok(
      Math.abs(sampler.freeze()! - 60) <= 1,
      "freeze 末值同样从真值起算"
    );

    // 同源下调（补发回退/抖动）不得产出负速率：分子取 max(0, Δ)。
    const dropped = sampler.sample(590, "usage", startMs + 2_550);
    assert.equal(dropped, 0, "同源负增量应归零而非负值");
  });

  it("窗口折叠后的首个新样本重 seed：freeze 回落到折叠前末值（多步 run 终态速率）", () => {
    const sampler = createTokenRateSampler();
    const startMs = 100_000;
    // 第一步：200 t/s 跑 1.5s（每 250ms +50）。
    for (let i = 1; i <= 6; i += 1) {
      sampler.sample(i * 50, "usage", startMs + i * 250);
    }
    const firstStepTail = sampler.freeze();
    assert.ok(
      firstStepTail != null && Math.abs(firstStepTail - 200) <= 5,
      `第一步末值速率应约 200：${firstStepTail}`,
    );

    // 工具 step 静默 3s（> 窗口 2.5s），第二步首个样本到达：与上个样本相隔
    // 3s，旧样本再也不会进任何未来窗口 → 先进回落值再清空重 seed。
    const afterSilence = sampler.sample(600, "usage", startMs + 4_500);
    assert.equal(afterSilence, null, "跨静默重 seed 后样本不足，省略速率段");
    // 关键回归：freeze 不返回 null 也不返回陈速率——回落「最后一段稳定输出」。
    assert.equal(sampler.freeze(), firstStepTail);

    // 第二步窗口从新样本起算（600→740，每 250ms +35 = 140 t/s）。
    for (let i = 1; i <= 3; i += 1) {
      sampler.sample(600 + i * 35, "usage", startMs + 4_500 + i * 250);
    }
    const secondStep = sampler.sample(740, "usage", startMs + 5_500);
    assert.ok(
      secondStep != null && Math.abs(secondStep - 140) <= 5,
      `第二步速率应按新窗口起算（≈140）而非跨 step 长窗平均：${secondStep}`,
    );
    assert.ok(
      Math.abs(sampler.freeze()! - 140) <= 5,
      "第二步形成窗口后 freeze 改用新窗口末值",
    );
  });

  it("跨静默（> 窗口时长）时旧样本不进新窗口；未超窗口的暂停仍走衰减语义", () => {
    const sampler = createTokenRateSampler();
    const startMs = 100_000;
    sampler.sample(0, "usage", startMs);
    sampler.sample(100, "usage", startMs + 250);
    sampler.sample(200, "usage", startMs + 500);
    // 暂停 2s（< 2.5s 窗口）：不重 seed，旧样本仍在窗口内，速率被分母拖低。
    const paused = sampler.sample(200, "usage", startMs + 2_500);
    assert.ok(
      paused != null && paused > 0 && paused < 200,
      `2s 暂停应走衰减语义（≈80）：${paused}`,
    );
    // 再产出：与上个样本相隔 2s（< 窗口）→ 不重 seed；窗口内可用段是
    // 100@t+250 → 300@t+2750（增量 200 ÷ 2.5s = 80 t/s），旧样本按窗口裁剪。
    const resumed = sampler.sample(300, "usage", startMs + 2_750);
    assert.ok(
      resumed != null && Math.abs(resumed - 80) <= 1,
      `恢复后按窗口内可用段差分（≈80）：${resumed}`,
    );

    // 超过窗口时长的静默：旧样本被清掉，新窗口从新样本起算。
    const afterLongSilence = sampler.sample(500, "usage", startMs + 8_000);
    assert.equal(afterLongSilence, null, "跨窗口静默后的首个新样本无窗可算");
    const nextWindow = sampler.sample(600, "usage", startMs + 8_250);
    assert.ok(
      nextWindow != null && Math.abs(nextWindow - 400) <= 1,
      `新窗口只算静默后的增量（500→600 in 250ms = 400）：${nextWindow}`,
    );
  });

  it("时钟回拨不触发窗口折叠重 seed（分支不变）", () => {
    const sampler = createTokenRateSampler();
    const startMs = 100_000;
    sampler.sample(0, "usage", startMs);
    for (let i = 1; i <= 6; i += 1) {
      sampler.sample(i * 50, "usage", startMs + i * 250);
    }
    const beforeReset = sampler.freeze();
    // 回拨到 1s 处采样（累计值也变了）：入口丢弃（不新增样本、不重 seed）。
    sampler.sample(320, "usage", startMs + 1_000);
    assert.equal(sampler.freeze(), beforeReset);
    assert.equal(sampler.rateAt(startMs + 1_500), 200);
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

  it("同毫秒多条 delta 只留最终累计值（core-metrics/B-1）", () => {
    const sampler = createTokenRateSampler();
    const startMs = 100_000;
    // 同一渲染节拍内的 3 条 delta（累计 100 → 200 → 300）：同刻去重后只剩
    // 一条样本，窗口样本不足 → null，而不是「300 t ÷ 0~几毫秒」的爆表值。
    sampler.sample(100, "usage", startMs);
    sampler.sample(200, "usage", startMs);
    const sameTick = sampler.sample(300, "usage", startMs);
    assert.equal(sameTick, null, "同刻只剩 1 条样本应按样本不足省略速率段");
    // 5ms 后只读：仍是 null——旧实现此时会给出 300 t ÷ 5ms = 60000 t/s。
    assert.equal(sampler.rateAt(startMs + 5), null);
    // 第二时刻样本到达后恢复：分子只算真实增量（300 → 350 in 5ms）。
    const next = sampler.sample(350, "usage", startMs + 5);
    assert.equal(next, 10_000);
  });

  it("时钟回拨期采样入口丢弃、序列不倒序，恢复后照常记样本（core-metrics/B-4）", () => {
    const sampler = createTokenRateSampler();
    const startMs = 100_000;
    sampler.sample(0, "usage", startMs);
    sampler.sample(50, "usage", startMs + 250);
    sampler.sample(100, "usage", startMs + 500);
    // 回拨 250ms：末样本（+500）成为未来样本 → 只按 0→50 算 200 t/s。
    assert.equal(sampler.rateAt(startMs + 250), 200);
    // 回拨期间继续采样：不新增样本（避免序列倒序污染后续窗口）。
    sampler.sample(150, "usage", startMs + 300);
    assert.equal(sampler.rateAt(startMs + 250), 200);
    // 时钟追上（同刻）→ 就地替换末样本；增量按真实累计值补齐。
    sampler.sample(200, "usage", startMs + 500);
    assert.equal(sampler.rateAt(startMs + 500), 400);
    // 再前进 → 正常记样本。
    const resumed = sampler.sample(250, "usage", startMs + 750);
    assert.equal(resumed, 250_000 / 750);
  });

  it("rateAt 只读不记样本：同 nowMs 幂等、暂停期随 nowMs 衰减、样本不足 null", () => {
    const sampler = createTokenRateSampler();
    // 0/1 个样本：null（首秒不显示抖动速率）。
    assert.equal(sampler.rateAt(100_000), null);
    sampler.sample(100, "usage", 100_000);
    assert.equal(sampler.rateAt(100_250), null);
    sampler.sample(200, "usage", 100_250);
    // 同 nowMs 连读两次同值（读数不改序列）。
    assert.equal(sampler.rateAt(100_250), 400);
    assert.equal(sampler.rateAt(100_250), 400);
    // 暂停：只推进 nowMs，速率自然衰减；tokens 未变的采样不再产生样本，
    // 读数与衰减值一致（80 = 100 t ÷ 1.25s）。
    const decayed = sampler.rateAt(101_250);
    assert.ok(decayed != null && decayed < 400);
    sampler.sample(200, "usage", 101_250);
    assert.equal(sampler.rateAt(101_250), 80);
  });

  it("freeze 末值快照：窗口以最后样本时刻收尾（收尾前停顿不拉低）", () => {
    const sampler = createTokenRateSampler();
    sampler.sample(0, "usage", 100_000);
    for (let i = 1; i <= 8; i += 1) {
      sampler.sample(i * 50, "usage", 100_000 + i * 250);
    }
    // 输出停下 3s 后才收尾：freeze 仍给「最后一段在稳定输出时」的 200 t/s，
    // 而不是按收尾时刻算出的衰减值。
    const frozen = sampler.freeze();
    assert.ok(frozen != null && Math.abs(frozen - 200) <= 5, `freeze=${frozen}`);
    // 对照：同刻 rateAt 已被停顿拖低（103s 时读数 ~117 t/s，105s 时归零）。
    assert.ok(sampler.rateAt(103_250) != null);
    assert.ok(
      (sampler.rateAt(105_250) ?? 0) < 60,
      "对照：同刻 rateAt 已被停顿拖低",
    );
  });

  it("freeze 在样本不足以成窗口时回落到校正翻转前的末值（openai 收尾真值场景）", () => {
    const sampler = createTokenRateSampler();
    sampler.sample(0, "heuristic", 100_000);
    for (let i = 1; i <= 6; i += 1) {
      sampler.sample(i * 30, "heuristic", 100_000 + i * 250);
    }
    const heuristicTail = sampler.freeze();
    assert.ok(heuristicTail != null);
    // usage 真值在收尾到达：翻转重 seed → 只有 1 个样本，成不了窗口。
    sampler.sample(600, "usage", 101_600);
    assert.equal(sampler.freeze(), heuristicTail);
    // 翻转后若又攒够样本，freeze 改用真值尺度的尾部窗口。
    sampler.sample(630, "usage", 101_850);
    const usageTail = sampler.freeze();
    assert.ok(usageTail != null && Math.abs(usageTail - 120) <= 1);
    // reset 清空回落值（跨 run 不残留）。
    sampler.reset();
    assert.equal(sampler.freeze(), null);
  });
});
