#!/usr/bin/env node
// 桌面端 e2e 全量序列 runner：清库 → 依序跑 8 个脚本（stdio 继承直出日志）→ 汇总表 → 任一非零 exit 1。
//
// vite 生命周期（lib.mjs 端口探测式复用）：子进程注入 E2E_REUSE_VITE=1，首个脚本自起
// vite，后续脚本探测 5173 直接复用；各 case 的 shutdown 只关 electron 不关 vite，且
// 序列模式下 lib.mjs 的 exit 兜底不杀 ownVite（留给后续脚本），末尾由本脚本的
// shutdownVite() 统一回收。中间脚本异常退出不断复用链（它没起 vite），探测式语义自愈。
//
// 用法：node run-all.mjs [--only a,b]（不带 .mjs 后缀，冒烟/分批调试用）
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shutdownVite } from "./lib.mjs";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(E2E_DIR, "data");

const SCRIPTS = [
  "bootstrap.mjs",
  "case-regression-fixes.mjs",
  "case-session-mgmt.mjs",
  "case-models-skills.mjs",
  "case-s3-update.mjs",
  "case-subagent.mjs",
  "case-zip-backup.mjs",
  "case-annotate2.mjs",
];

// --only 过滤（支持省略 .mjs 后缀）；含未知名直接报错退出，防静默跑空
const onlyIdx = process.argv.indexOf("--only");
if (onlyIdx !== -1) {
  const wanted = String(process.argv[onlyIdx + 1] ?? "").split(",").map((s) => s.trim().replace(/\.mjs$/, "")).filter(Boolean);
  const filtered = SCRIPTS.filter((s) => wanted.includes(s.replace(/\.mjs$/, "")));
  if (filtered.length !== wanted.length) {
    console.error(`--only 含未知脚本名；可用值：${SCRIPTS.map((s) => s.replace(/\.mjs$/, "")).join(", ")}`);
    process.exit(2);
  }
  SCRIPTS.length = 0;
  SCRIPTS.push(...filtered);
}

// 清测试库（rm -rf data/* 后重建目录）——与单跑 bootstrap 前的手工清库等价
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

const results = [];
let failed = false;
for (const script of SCRIPTS) {
  console.log(`\n===== RUN ${script} =====`);
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    // 子进程注入 E2E_REUSE_VITE=1：序列模式——lib.mjs 的 exit 兜底不杀 ownVite，
    // 首个脚本起的 vite 得以存活给后续脚本复用，末尾由 shutdownVite() 统一回收
    const child = spawn("node", [path.join(E2E_DIR, script)], {
      stdio: "inherit",
      env: { ...process.env, E2E_REUSE_VITE: "1" },
    });
    child.on("exit", resolve);
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({ script, code, secs });
  if (code !== 0) failed = true;
  console.log(`===== EXIT ${script} code=${code} ${secs}s =====`);
}

// 汇总表：脚本名/退出码/耗时
console.log("\n===== SUMMARY =====");
for (const r of results) {
  console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.script.padEnd(28)} exit=${r.code}  ${r.secs}s`);
}
const total = results.reduce((s, r) => s + Number(r.secs), 0).toFixed(1);
console.log(`TOTAL ${total}s`);

// 兜底清场：各 case 的 shutdown 已不关 vite（复用语义），这里统一回收本 worktree 的 vite
shutdownVite();
process.exit(failed ? 1 : 0);
