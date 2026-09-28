// P0 (cr-01) device evidence: watch the DB dir during a cold launch that has
// zero pending rows. If the maintenance chain (GC+checkpoint+VACUUM) re-runs,
// we should see the main file rewritten (mtime) and/or -journal transients.
// Usage: node tmp/p0-watch.mjs <seconds>
import { execSync } from "node:child_process";

const seconds = Number(process.argv[2] ?? 45);
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function snapshot() {
  try {
    const out = sh('adb shell "run-as com.novelmaster ls -la databases/"');
    const files = {};
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^\S+\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?)\s+(\S+)$/);
      if (m) files[m[3]] = `${m[1]}@${m[2]}`;
    }
    return files;
  } catch (e) {
    return { ERROR: String(e).slice(0, 120) };
  }
}

let prev = snapshot();
const t0 = Date.now();
console.log(`[t+0.0s] baseline:`, JSON.stringify(prev));
const seen = new Set(Object.keys(prev));
for (let i = 0; i < seconds; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const cur = snapshot();
  let changed = false;
  for (const [k, v] of Object.entries(cur)) {
    if (prev[k] !== v) {
      console.log(`[t+${((Date.now() - t0) / 1000).toFixed(1)}s] ${prev[k] === undefined ? "NEW " : "CHG "} ${k}: ${prev[k] ?? "-"} -> ${v}`);
      changed = true;
    }
  }
  for (const k of Object.keys(prev)) {
    if (!(k in cur)) {
      console.log(`[t+${((Date.now() - t0) / 1000).toFixed(1)}s] GONE ${k}: ${prev[k]}`);
      changed = true;
    }
  }
  prev = cur;
}
try { console.log("pid:", sh('adb shell "pidof com.novelmaster || echo STOPPED"').trim()); } catch {}
