#!/usr/bin/env node
/**
 * 拉取 Android 设备上 novel-master 的运行日志到本地。
 *
 * 为什么需要它：core/双端的日志 sink 都写 app 沙盒 `files/logs/`，`console.*`
 * 在正式包里看不到、logcat 也只覆盖 RN 层崩溃。debug 包可用 `adb run-as`
 * 直接读；**正式包不可 run-as**，只能由用户从 app 内导出（设置页 → 导出日志）
 * 再把文件路径给 agent。本脚本把这两种情况收敛成一条命令，避免每次排查先花
 * 几轮确认"日志到底能不能读"。
 *
 * 用法：
 *   node scripts/pull-nm-logs.mjs            # 拉今天
 *   node scripts/pull-nm-logs.mjs 20261114   # 拉指定日期
 *   node scripts/pull-nm-logs.mjs --all      # 拉全部
 *
 * 产出：tmp/nm-logs/<日期>.log（gitignore 覆盖 tmp/），并打印每个文件的行数与
 * 末尾 5 行；`--grep <关键字>` 可只打印命中行（等价于 grep -a）。
 */

import {execFileSync} from "node:child_process";
import {mkdirSync, writeFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

const PACKAGE = "com.novelmaster";
const LOG_DIR = "files/logs";
const OUT_DIR = join(process.cwd(), "tmp", "nm-logs");

function adb(args) {
  return execFileSync("adb", args, {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const grepIdx = args.indexOf("--grep");
const grep = grepIdx >= 0 ? args[grepIdx + 1] : null;
const day = args.find((arg) => /^\d{8}$/.test(arg));

let devices;
try {
  // adb 在 Windows 上输出 CRLF，行尾 `\r` 会让 `/\tdevice$/` 失配——统一去 CR 再判。
  devices = adb(["devices"]).split(/\r?\n/).map((line) => line.trim()).filter((line) => /\tdevice$/.test(line)).map((line) => line.split("\t")[0]);
} catch (error) {
  fail(`adb 不可用：${error instanceof Error ? error.message : String(error)}`);
}
if (devices.length === 0) fail("没有已连接的设备（adb devices 为空）");

let listing;
try {
  listing = adb(["shell", "run-as", PACKAGE, "ls", LOG_DIR]);
} catch {
  fail(
    [
      "无法 run-as 读取 " + LOG_DIR + " —— 说明设备上装的是**正式包**（release 不可 debug）。",
      "正式包日志只能从 app 内导出：设置 → 关于/诊断 → 导出日志，把导出的文件路径给 agent。",
      "（debug 包可直接重跑本脚本。）",
    ].join("\n"),
  );
}

const files = listing
  .split("\n")
  .map((line) => line.trim().split(/\s+/).pop())
  .filter((name) => name != null && name.startsWith("nm-") && name.endsWith(".log") && (all || (day == null ? true : name.includes(day))))
  .filter((name) => (all || day != null ? true : name === `nm-${todayName()}.log`));

function todayName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

if (files.length === 0) fail(`设备上没有匹配的日志文件（ls ${LOG_DIR} 结果：${listing.trim().replace(/\s+/g, " ")}）`);

mkdirSync(OUT_DIR, {recursive: true});
for (const name of files) {
  const content = adb(["exec-out", "run-as", PACKAGE, "cat", `${LOG_DIR}/${name}`]);
  writeFileSync(join(OUT_DIR, name), content, "utf8");
  const lines = content.split("\n");
  if (grep != null) {
    const hits = lines.filter((line) => line.includes(grep));
    console.log(`=== ${name}（grep "${grep}"：${hits.length} 行）===`);
    for (const hit of hits.slice(-30)) console.log(hit);
  } else {
    console.log(`=== ${name}（${lines.length} 行，本地 tmp/nm-logs/${name}）===`);
    for (const line of lines.slice(-5)) if (line.length > 0) console.log(line);
  }
}

if (readdirSync(OUT_DIR).length > 0) console.log(`\n已落盘目录：${OUT_DIR}`);
