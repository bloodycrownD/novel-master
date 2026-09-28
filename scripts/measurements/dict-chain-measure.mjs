// 字典链方案模拟（对照 pack）：真库副本，跑完即弃
import Database from "better-sqlite3";
import { zlibSync, unzlibSync } from "fflate";
import fs from "node:fs";

const db = new Database(process.argv[2], { readonly: true });
const q = (sql) => db.prepare(sql).all();
const out = [];
const W = (...a) => out.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
const b64ToBytes = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const dec = new TextDecoder("utf-8");
const enc = new TextEncoder();
const Z = (s, dict) => zlibSync(enc.encode(s), dict ? { level: 6, dictionary: dict } : { level: 6 }).byteLength;
const RAW = (s) => enc.encode(s).byteLength;
const MB = (n) => (n / 1048576).toFixed(3);

function plainOf(encoding, bytes) {
  if (encoding === "zlib") {
    const bin = typeof bytes === "string" ? b64ToBytes(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return dec.decode(unzlibSync(bin));
  }
  const s = typeof bytes === "string" ? bytes : dec.decode(bytes);
  return dec.decode(unzlibSync(b64ToBytes(s.trim())));
}

const blobs = new Map();
for (const r of q("SELECT content_hash h, encoding e, bytes b, LENGTH(bytes) tb FROM vfs_content_blob")) {
  blobs.set(r.h, { e: r.e, b: r.b, tb: r.tb, plain: null });
}
const getPlain = (h) => {
  const b = blobs.get(h);
  if (b.plain === null) b.plain = plainOf(b.e, b.b);
  return b.plain;
};
const binLen = (h) => (blobs.get(h).e === "zlib-b64" ? Math.round((blobs.get(h).tb * 3) / 4) : blobs.get(h).tb);

const revs = q("SELECT entry_id eid, version v, status st, content_hash h FROM vfs_revision ORDER BY entry_id, version");
const entries = new Map();
for (const r of q("SELECT entry_id id, head_version hv FROM vfs_entry")) entries.set(r.id, r);
const byEntry = new Map();
for (const r of revs) {
  if (r.st !== "active" || !r.h) continue;
  if (!byEntry.has(r.eid)) byEntry.set(r.eid, []);
  byEntry.get(r.eid).push(r);
}

for (const CAP of [Infinity, 16, 8, 4, 2]) {
  let total = 0, standaloneTotal = 0, dictRows = 0, maxDepth = 0, deepReads = 0;
  for (const [eid, list] of byEntry) {
    const uniq = [...new Set(list.map((r) => r.h))];
    const depth = new Map();
    let prev = null;
    for (const h of uniq) {
      const plain = getPlain(h);
      const baseDepth = prev !== null ? depth.get(prev) : Infinity;
      const plainBytes = RAW(plain);
      const useDict = prev !== null && baseDepth < CAP && plainBytes <= 1 << 20;
      if (useDict) {
        total += Z(plain, enc.encode(getPlain(prev)));
        depth.set(h, baseDepth + 1);
        dictRows++;
        maxDepth = Math.max(maxDepth, baseDepth + 1);
        if (baseDepth + 1 >= 4) deepReads++;
      } else {
        total += Z(plain);
        depth.set(h, 0);
      }
      standaloneTotal += Z(plain);
      prev = h;
    }
  }
  W(`== 字典链 CAP=${CAP === Infinity ? "∞" : CAP} ==`);
  W("  独立压 =", MB(standaloneTotal), "MB → 字典链 =", MB(total), "MB  省", MB(standaloneTotal - total), "MB /",
    (((standaloneTotal - total) / standaloneTotal) * 100).toFixed(1) + "%");
  W("  字典行 =", dictRows, " 最大链深 =", maxDepth, " 链深>=4 的行 =", deepReads);
}

fs.writeFileSync("tmp/dict-chain.out.txt", out.join("\n"), "utf8");
console.log("written tmp/dict-chain.out.txt");
