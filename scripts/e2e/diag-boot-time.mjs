// 冒烟计时：launchApp→waitForAppReady 启动段耗时（不含业务步骤）——对比新旧 lib 的结构性提速
import { performance } from "node:perf_hooks";
import { launchApp, waitForAppReady, shutdown, shutdownVite } from "./lib.mjs";

const t0 = performance.now();
const { app, page, vite } = await launchApp({});
await waitForAppReady(page);
const ms = Math.round(performance.now() - t0);
console.log(`BOOT_SEGMENT_MS ${ms}`);
console.log(`VITE_OWN ${vite ? "spawned" : "reused"}`);
await shutdown(app, vite, null);
if (vite) shutdownVite(); // 计时脚本自起自关，不留孤儿
process.exit(0);
