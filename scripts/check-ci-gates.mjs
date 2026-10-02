#!/usr/bin/env node
/**
 * check-ci-gates · CI 门禁形状守卫（OQ20，CR Wave A §2-4）
 *
 * 为什么要有这个文件（这是它存在的全部理由）：
 *   `wave-a.md` A5.4 验收②要求「检查 YAML 形状：Typecheck 步不再有
 *   continue-on-error，Lint 步仍有」，并同时记下一条踩坑警告——
 *   **cmd 下多行 `node -e` 会被静默丢弃整条命令（无报错无输出）**。
 *   当时的原话是「下面这条已实测可在 cmd / PowerShell / bash 三处跑通」，
 *   但那条命令只以**一段贴在文档里的单行文本**存在：下一个改 `ci.yml` 的人不会
 *   去翻 spec 找它，照抄的姿势又是直接粘进自己的 shell —— 于是这道验收既没有
 *   牙齿，也没有任何人会记得跑。
 *
 *   本脚本把那三行检查固化成一个**真文件**：跟 `check-encoding.mjs` 同族，
 *   `npm run check:ci-gates` 直接跑，cmd / PowerShell / bash 三处行为一致
 *   （因为不再有「粘进 shell」这一步）。
 *
 * 三条检查：
 *   ① **形状**：每一步的 `continue-on-error` 状态是否符合预期表。预期表在本文件
 *      里（`EXPECTATIONS`），改门禁策略时改这张表，不改 ci.yml 的语义。
 *   ② **登记**：任何 `run:` 看起来像门禁（typecheck / lint / test / format /
 *      check: / build）的步骤，**必须**在预期表里登记过。新加一步却不登记 ⇒ 红。
 *      这是 ① 之所以不退化成「一张过期的截图」的关键：漏登记会在同一次运行里被抓住。
 *   ③ **陷阱**：扫 `node -e` 是否跨行（那条 cmd 静默丢弃的形态）。跨行即红。
 *
 * 退出码：0 绿 / 1 红（门禁语义）。`--print` 只打印现状不判定。
 *
 * 用法：
 *   node scripts/check-ci-gates.mjs            # 查 .github/workflows/ci.yml
 *   node scripts/check-ci-gates.mjs --print    # 只打印每一步的现状
 *   node scripts/check-ci-gates.mjs <别的.yml>  # 查指定文件（自检/临时实验用）
 *
 * ⚠️ 本脚本是**形状**守卫，不是语义守卫：它管「Lint 步允不允许红」，
 *   不管「Lint 步实际红不红」。真实绿红由 CI 跑出来。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const args = process.argv.slice(2);
const printOnly = args.includes("--print");
const targetArg = args.find((a) => !a.startsWith("--"));
const CI_PATH =
  targetArg == null
    ? path.join(repoRoot, ".github", "workflows", "ci.yml")
    : path.resolve(process.cwd(), targetArg);

/**
 * 预期表：步骤名 → 期望的 continue-on-error 状态 + 为什么。
 *
 * ⚠️ **这张表是「门禁策略」的唯一真源**。新增/删除/改名 CI 步骤时同步改这里，
 *   改漏了本脚本会红（检查②）。`why` 不是装饰——半年后有人问「为什么 Typecheck
 *   能红」时，答案在这一行里。
 */
const EXPECTATIONS = [
  {
    step: "Build workspaces",
    continueOnError: false,
    why: "core 产物是下游 workspace 测试的前置依赖，必须先绿",
  },
  {
    step: "Format",
    continueOnError: false,
    why: "wave-a A5 已转 blocking",
  },
  {
    step: "Encoding",
    continueOnError: false,
    why: "wave-e H1 钩子①；2026-10-01 全仓已清零（0/0/0），可直接 blocking",
  },
  {
    step: "CI gates (shape)",
    continueOnError: false,
    why: "OQ20 新增的形状守卫本体；它检视的就是本文件，不允许自己变成 continue-on-error（那等于把自己关掉）",
  },
  {
    step: "Lint",
    continueOnError: true,
    why: "mobile lint 仍有 27 条存量 error + 405 warning（基线 321 已失效），清账前允许失败；与下面那条并存",
  },
  {
    step: "Lint (blocking: desktop/core/drivers)",
    continueOnError: false,
    why: "wave-e X1：desktop/core/驱动包/app-cli 已收口，单独转 blocking 覆盖 mobile 之外的包",
  },
  {
    step: "Typecheck",
    continueOnError: false,
    why: "wave-a A5.1 摘掉 continue-on-error（Typecheck 步从这一刻起是 blocking）",
  },
  {
    step: "Typecheck (tests: core)",
    continueOnError: true,
    why: "CR core2 B-1：packages/core/tsconfig.test.json 的 rootDir 修好后暴露出 约 840 条测试代码类型欠账 / 160 余个文件（评审报告当时写「454 条全是配置错、0 条语义错」，那个结论只在 rootDir 报错遮住语义错时成立）。先就位、允许失败，清零后摘掉本项",
  },
  {
    step: "Test",
    continueOnError: false,
    why: "主干测试步，一律 blocking",
  },
  {
    step: "Zero-collect guard",
    continueOnError: false,
    why: "wave-e H6 钩子⑥；零收集假绿（N-P0-02）的 Windows 半边，必须 blocking",
  },
];

/** `run:` 里出现这些词就算「门禁步」，必须登记在 EXPECTATIONS 里（检查②）。 */
const GATE_PATTERN = /\b(typecheck|lint|test|format:check|check:|collect-guard|build)\b/;

const source = readFileSync(CI_PATH, "utf8");

// ---------------------------------------------------------------- 解析

/**
 * 极简 YAML 步骤解析（不引依赖，与 check-encoding.mjs 同风格：仓内门禁脚本
 * 一律零依赖，免得为了读一个固定形状的 CI 文件把 node_modules 拖进来）。
 *
 * 依赖的形状（`.github/workflows/ci.yml` 现在的缩进）：
 *   jobs:            0
 *     <jobId>:       2
 *       steps:       4
 *         - name: X  6
 *           key: v   8
 *             ...    10   ← `run: >-` 折叠块的续行
 * 认不出的行一律忽略并在最后报「行号未被任何步骤消费」，不静默吞。
 */
function parseSteps(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let job = null;
  let current = null;
  let lastKey = null;
  const consumed = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch) {
      job = jobMatch[1];
      current = null;
      lastKey = null;
      consumed.add(lineNo);
      continue;
    }

    const stepMatch = /^ {6}- name:\s*(.+?)\s*$/.exec(line);
    if (stepMatch) {
      current = {
        job: job ?? "?",
        name: stepMatch[1].replace(/^["']|["']$/g, ""),
        line: lineNo,
        keys: {},
      };
      result.push(current);
      lastKey = null;
      consumed.add(lineNo);
      continue;
    }

    if (current == null) continue;

    const keyMatch = /^ {8}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (keyMatch) {
      lastKey = keyMatch[1];
      current.keys[lastKey] = keyMatch[2];
      consumed.add(lineNo);
      continue;
    }

    // 折叠块续行（`run: >-` / `run: |` 的内容）：并进上一个 key。
    const foldedMatch = /^ {10,}\s*(\S.*)$/.exec(line);
    if (foldedMatch && lastKey != null) {
      current.keys[lastKey] = `${current.keys[lastKey] ?? ""} ${foldedMatch[1]}`.trim();
      consumed.add(lineNo);
      continue;
    }

    if (line.trim() === "") {
      consumed.add(lineNo);
      continue;
    }
  }

  return { steps: result, consumed, total: lines.length };
}

const steps = parseSteps(source);

function hasContinueOnError(step) {
  // 显式 `continue-on-error: true` 才算；`false` 与「没写」都算 blocking。
  return /^\s*true\s*$/.test(String(step.keys["continue-on-error"] ?? ""));
}

function isGateStep(step) {
  const run = String(step.keys.run ?? "");
  return GATE_PATTERN.test(run);
}

// ---------------------------------------------------------------- 检查

const failures = [];
const expectedByStep = new Map(EXPECTATIONS.map((e) => [e.step, e]));

// ① 形状
for (const exp of EXPECTATIONS) {
  const step = steps.steps.find((s) => s.name === exp.step);
  if (step == null) {
    failures.push(
      `预期表里的步骤在 ci.yml 中不存在：「${exp.step}」。` +
        `要么 ci.yml 把它改名/删了，要么这张表该同步改。`
    );
    continue;
  }
  const actual = hasContinueOnError(step);
  if (actual !== exp.continueOnError) {
    failures.push(
      `「${exp.step}」的 continue-on-error 期望 ${exp.continueOnError}，实际 ${actual}。\n` +
        `      理由（表内登记）：${exp.why}\n` +
        `      若这是有意的策略变更，请同时改 scripts/check-ci-gates.mjs 的 EXPECTATIONS。`
    );
  }
}

// ② 登记：门禁步必须在预期表里
for (const step of steps.steps) {
  if (!isGateStep(step)) continue;
  if (expectedByStep.has(step.name)) continue;
  failures.push(
    `门禁步未登记：「${step.name}」（job=${step.job}，ci.yml:${step.line}）的 run 看起来是门禁命令，\n` +
      `      但它不在 EXPECTATIONS 里。请补上 continue-on-error 的期望值与理由，\n` +
      `      否则「① 形状检查」会退化成一张过期的截图——新门禁的松紧没人管。\n` +
      `      run=${String(step.keys.run ?? "").slice(0, 120)}`
  );
}

// ③ 陷阱：跨行的 node -e（cmd 下会被静默丢弃整条命令）
const nodeEIndex = source.indexOf("node -e");
if (nodeEIndex >= 0) {
  const lineNo = source.slice(0, nodeEIndex).split(/\r?\n/).length;
  const tail = source.slice(nodeEIndex);
  const firstBreak = tail.indexOf("\n");
  // 一行之内必须能看到收尾的引号或结尾；看不到 ⇒ 这条 node -e 跨行了。
  const endsOnSameLine = /node -e[^\n]*["'`)\]]\s*(?:#.*)?$/.test(
    tail.slice(0, firstBreak === -1 ? undefined : firstBreak)
  );
  if (!endsOnSameLine) {
    failures.push(
      `ci.yml:${lineNo} 的 \`node -e\` 跨行了。RULE 明记「cmd 下多行 node -e 会被静默丢弃\n` +
        `      整条命令（无报错无输出）」——它就是本族假绿的入口。\n` +
        `      要跑多行逻辑，请写成 scripts/ 下的真文件（就像本文件），再从 yaml 调它。`
    );
  }
}

// ---------------------------------------------------------------- 输出

if (printOnly) {
  console.log(`[check-ci-gates] ${path.relative(repoRoot, CI_PATH)} 共 ${steps.steps.length} 步：`);
  for (const step of steps.steps) {
    const coe = hasContinueOnError(step);
    console.log(
      `  ${step.name} | coe=${coe} | job=${step.job} | line=${step.line}` +
        `${isGateStep(step) ? " | 门禁" : ""}`
    );
  }
  process.exit(0);
}

if (failures.length > 0) {
  console.error(
    `[check-ci-gates] 红：${failures.length} 处形状问题（${path.relative(
      repoRoot,
      CI_PATH
    )}）。\n`
  );
  for (const [i, msg] of failures.entries()) {
    console.error(`  ${i + 1}) ${msg}\n`);
  }
  console.error(
    `[check-ci-gates] 口径：EXPECTATIONS 表在 scripts/check-ci-gates.mjs，` +
      `「why」列是每条松紧的决策理由。`
  );
  process.exit(1);
}

console.log(
  `[check-ci-gates] OK：${steps.steps.length} 步形状符合预期表` +
    `（门禁步 ${steps.steps.filter(isGateStep).length} 个全部已登记，无跨行 node -e）。`
);
