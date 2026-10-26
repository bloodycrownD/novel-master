/**
 * Doom loop detection for repeated identical or alternating tool_use blocks.
 *
 * 检测是有状态的：跨轮判断要看本 run 已经发生过的 tool_use 轨迹。因此把配置
 * 与轨迹窗口一起收进 {@link DoomLoopDetector} 实例——run 起步 new 一个、每个
 * step 调一次 `checkStep`，调用方不再自己维护窗口数组（原实现在 runner 里
 * 手动 push/shift 并按 `window * 4` 裁剪，检查却只读尾窗，多出的缓冲纯属冗余）。
 *
 * 命中时返回 `Err`（载荷 `AppError`，key `AGENT_DOOM_LOOP`），runner 在边界抛出，
 * 由 run 收口转成 FAILED。
 *
 * @module domain/agent/logic/doom-loop
 */

import type { ContentBlock, ToolUseBlock } from "@/domain/chat/model/content-block.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/**
 * 构造参数；字段名与 agent 定义的 runtime 同名，可直接把 runtime 传进来。
 * 缺省值见 {@link DoomLoopDetector.DEFAULT_THRESHOLD} / {@link DoomLoopDetector.DEFAULT_CROSS_ROUND_WINDOW}。
 */
export interface DoomLoopConfig {
  readonly doomLoopThreshold?: number;
  readonly doomLoopCrossRoundWindow?: number;
}

/** 本模块唯一的失败载荷。 */
type DoomLoopError = AppError<"AGENT_DOOM_LOOP">;

/** 同名工具 + 逐字节相同的 JSON 输入视为「同一调用」（沿用旧实现口径）。 */
function sameToolUse(a: ToolUseBlock, b: ToolUseBlock): boolean {
  return a.name === b.name && JSON.stringify(a.input) === JSON.stringify(b.input);
}

/**
 * 单次 run 的死循环检测器：本步「同输入连击」+ 跨步「A-B-A-B 交替」。
 *
 * 一个实例服务一次 run；`checkStep` 会改变内部轨迹，换 run 复用同一实例前
 * 先调 {@link reset}（当前 runner 每 run 新建，reset 留给测试与将来的复用场景）。
 */
export class DoomLoopDetector {
  /** 连续相同 tool_use 达到该次数即判定死循环。 */
  static readonly DEFAULT_THRESHOLD = 3;
  /** 跨轮检查回看的 tool_use 窗口长度（须为 ≥4 的偶数才生效）。 */
  static readonly DEFAULT_CROSS_ROUND_WINDOW = 4;

  private readonly threshold: number;
  private readonly crossRoundWindow: number;
  /** 已观测的 tool_use 轨迹；只保留跨轮检查需要的最新一个窗口。 */
  private readonly trajectory: ToolUseBlock[] = [];

  constructor(config: DoomLoopConfig = {}) {
    this.threshold = config.doomLoopThreshold ?? DoomLoopDetector.DEFAULT_THRESHOLD;
    this.crossRoundWindow = config.doomLoopCrossRoundWindow ?? DoomLoopDetector.DEFAULT_CROSS_ROUND_WINDOW;
  }

  /**
   * 检查一个 step 的全部内容块，命中即返回 `Err`（本方法不抛）。
   *
   * 三步顺序固定：① 本步尾部同输入连击 → ② 本步 tool_use 折进轨迹 → ③ 跨轮
   * A-B-A-B。②③ 在本步检查之后，与旧实现两处调用点的先后一致。失败载荷是
   * `AppError`（key `AGENT_DOOM_LOOP`）；调用方按 `if (!r.ok)` 收窄后自行决定抛还是展示。
   *
   * nm-style: keep-public — 检测器实例状态（轨迹窗口）的唯一 step 入口，内联会拆散状态机。
   */
  checkStep(blocks: readonly ContentBlock[]): Result<void, DoomLoopError> {
    const toolUses = blocks.filter((b): b is ToolUseBlock => b.type === "tool_use");

    // ① 只查本步最后 threshold 个；不足 threshold 个不可能构成连击。
    if (toolUses.length >= this.threshold) {
      const tail = toolUses.slice(-this.threshold);
      const first = tail[0]!;
      if (tail.every((toolUse) => sameToolUse(toolUse, first))) {
        return Result.err(new AppError("AGENT_DOOM_LOOP", `Doom loop: tool "${first.name}" invoked ${this.threshold} times with identical input`));
      }
    }

    // ② 轨迹只需要跨轮检查要读的尾窗，多留没意义。
    this.trajectory.push(...toolUses);
    if (this.trajectory.length > this.crossRoundWindow) {
      this.trajectory.splice(0, this.trajectory.length - this.crossRoundWindow);
    }

    // ③ 窗口 <4 或奇数时交替没有意义：静默关闭该检查（沿用旧行为，配置写错
    // 只降级不炸 run），① 的连击检查照常生效。轨迹此时已被裁到至多一个窗口，
    // 长度够即恰好等于窗口，可直接读，不必再切片。
    if (this.crossRoundWindow < 4 || this.crossRoundWindow % 2 !== 0) {
      return Result.ok(undefined);
    }
    if (this.trajectory.length < this.crossRoundWindow) {
      return Result.ok(undefined);
    }
    const window = this.trajectory;
    const [a, b] = window;
    if (a == null || b == null || sameToolUse(a, b)) {
      return Result.ok(undefined);
    }
    if (!window.every((toolUse, idx) => sameToolUse(idx % 2 === 0 ? a : b, toolUse))) {
      return Result.ok(undefined);
    }
    return Result.err(new AppError("AGENT_DOOM_LOOP", `Doom loop: tools "${a.name}" and "${b.name}" alternate over the last ${this.crossRoundWindow} calls`));
  }

  /** 清空轨迹（复用实例换 run 时调用）。 */
  reset(): void {
    this.trajectory.length = 0;
  }
}
