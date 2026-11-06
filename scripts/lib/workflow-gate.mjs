/**
 * 门控包装器 —— workflow 的 world.run 用。完整输出落 .nm-gate/<gate>.log，stdout 只回摘要。
 *
 * 两个必需性：
 *  ① world.run 的 stdout 有 256KB 上限，core 全量测试的 TAP 输出约 817KB，直连会把 run 打挂；
 *  ② world.run 的 cwd 是主仓库 novel-master，而改动都在 tokfix worktree —— 本脚本 chdir 到
 *     仓库根（本文件在 scripts/lib/ 下，故上溯两级）再跑，否则测错树（错树假绿）。
 *
 * 用法：node scripts/lib/workflow-gate.mjs <gate>
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKTREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(WORKTREE);

const GATES = {
  "build-core": ["run", "build", "-w", "@novel-master/core"],
  "build-node": ["run", "build", "-w", "@novel-master/tokenizer-driver-node"],
  "build-rn": ["run", "build", "-w", "@novel-master/tokenizer-driver-rn"],
  "test-core": ["test", "-w", "@novel-master/core"],
  "test-node": ["test", "-w", "@novel-master/tokenizer-driver-node"],
  "typecheck-desktop": ["run", "typecheck", "-w", "@novel-master/desktop"],
  "typecheck-mobile": ["run", "typecheck", "-w", "@novel-master/mobile"],
  "typecheck-cli": ["run", "typecheck", "-w", "@novel-master/cli"],
  "test-mobile": [
    "test",
    "-w",
    "@novel-master/mobile",
    "--",
    "--silent",
    "chat-prompt-tokens",
    "use-chat-tab-scope",
    "agent-editor",
  ],
};

const name = process.argv[2];
const spec = GATES[name];
if (!spec) {
  console.error(`[nm-gate] 未知门控：${name}；可用：${Object.keys(GATES).join(", ")}`);
  process.exit(2);
}

const logDir = path.join(WORKTREE, ".nm-gate");
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, `${name}.log`);

const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const started = Date.now();
const r = fs.existsSync(npmCli)
  ? spawnSync(process.execPath, [npmCli, ...spec], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  : spawnSync("npm.cmd", spec, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, shell: true });

const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
fs.writeFileSync(logPath, out, "utf8");
const lines = out.split(/\r?\n/).filter((l) => l.length > 0);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const status = r.error ? 1 : (r.status ?? 1);

console.log(`GATE ${name} EXIT=${status} TIME=${seconds}s LINES=${lines.length} LOG=${logPath}`);
console.log(lines.slice(status === 0 ? -12 : -200).join("\n"));
if (r.error) console.error(`[nm-gate] spawn 异常：${r.error.message}`);
process.exit(status);
