/**
 * zero-collect-guard · 通用零收集守卫（wave-e H6 Step 1）。
 *
 * **为什么需要它**：node ≥22 的 `--test` 收集到 0 条用例时**退出码是 0**。
 * 传一个拼错的 glob 就是「`# tests 0` + exit 0」的假绿；桌面端历史上更狠——
 * 单引号 + `shell: true` 在 Windows 上会让整条命令被静默吃掉（issue N-P0-02），
 * 同样是 0 条 + 全绿。两种形态的共同点：**「什么都没跑」和「全跑过了」在退出码上无法区分**。
 *
 * 本模块把「复核收集数」这一步收编成一处，各 app 的 run-tests 只负责报出自己的
 * 诊断信息（cwd / glob / 平台 / 子进程错误码），不再各自复刻正则与退出码逻辑。
 *
 * 两个出口：
 * - {@link parseCollectedCount}：从 tap reporter 的 stdout 里抓 `# tests N`，抓不到返回 `null`；
 * - {@link assertNonZeroCollected}：`null`（缺失）或 `0` 一律 `exit 1`，并打印诊断。
 *
 * ⚠️ 退出而非抛错：这些脚本的失败形态就是「命令红」，抛错在 spawnSync 的
 * 父进程里未必变成非零退出码（尤其是被包在 shell 里跑的时候）。
 *
 * 用法见 `apps/desktop/scripts/run-tests.mjs` 与 `apps/cli/scripts/run-tests.mjs`。
 */

/**
 * 从 tap reporter 的 stdout 里解析 `# tests N`。
 * @param {string | null | undefined} stdout
 * @returns {number | null} 收集到的用例数；行缺失（不是 0）时返回 `null`
 */
export function parseCollectedCount(stdout) {
  const matched = /^\s*# tests (\d+)$/m.exec(stdout ?? "");
  return matched ? Number(matched[1]) : null;
}

/**
 * 零收集守卫：`collected` 为 0 或缺失即 `process.exit(1)`，否则正常返回。
 *
 * @param {object} params
 * @param {number | null | undefined} params.collected 实测收集数（{@link parseCollectedCount} 的返回值）
 * @param {string} params.where 出问题的位置，例：`apps/desktop run-tests.mjs`
 * @param {readonly string[]} [params.details] 附加诊断（cwd / glob / 平台 / 子进程错误码）
 * @returns {void}
 */
export function assertNonZeroCollected({ collected, where, details = [] }) {
  if (typeof collected === "number" && collected > 0) return;
  const reported = collected === null || collected === undefined ? "(缺失)" : String(collected);
  console.error(
    `[zero-collect-guard] 拒绝把空跑当全绿放行：${where} 实测 # tests ${reported}。` +
      `node --test 收集 0 条时退出码仍是 0，所以这条必须显式判。`,
  );
  for (const detail of details) {
    if (detail) console.error(`[zero-collect-guard]   · ${detail}`);
  }
  process.exit(1);
}
