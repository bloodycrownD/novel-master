// v2：按 content_hash 去重后的诚实口径（跑完即弃）
// 输出 tmp/vfs-pack-measure2.out.txt
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
const Z = (s) => zlibSync(enc.encode(s), { level: 6 }).byteLength;
const RAW = (s) => enc.encode(s).byteLength;
const MB = (n) => (n / 1048576).toFixed(3);

function plainOf(encoding, bytes) {
  if (encoding === "zlib") {
    const bin = typeof bytes === "string" ? b64ToBytes(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return dec.decode(unzlibSync(bin));
  }
  if (encoding === "zlib-b64") {
    const s = typeof bytes === "string" ? bytes : dec.decode(bytes);
    return dec.decode(unzlibSync(b64ToBytes(s.trim())));
  }
  throw new Error("bad encoding " + encoding);
}

const blobs = new Map();
for (const r of q("SELECT content_hash h, encoding e, bytes b, byte_len bl FROM vfs_content_blob")) {
  blobs.set(r.h, { e: r.e, b: r.b, bl: r.bl, plain: null });
}
const getPlain = (h) => {
  const b = blobs.get(h);
  if (b.plain === null) b.plain = plainOf(b.e, b.b);
  return b.plain;
};
// 统一按“二进制压缩大小”口径比较（base64 文本按 4/3 折算）
const binSize = (h) => {
  const b = blobs.get(h);
  return b.e === "zlib-b64" ? Math.ceil(b.bl / 4) * 3 : b.bl;
};

const revs = q("SELECT entry_id eid, version v, status st, content_hash h FROM vfs_revision ORDER BY entry_id, version");
const entries = new Map();
for (const r of q("SELECT entry_id id, scope_key sk, path p, content_hash h, head_version hv FROM vfs_entry")) entries.set(r.id, r);

const byEntry = new Map();
for (const r of revs) {
  if (r.st !== "active" || !r.h) continue;
  if (!byEntry.has(r.eid)) byEntry.set(r.eid, []);
  byEntry.get(r.eid).push(r);
}

// 全库去重口径
const allUnique = new Set([...byEntry.values()].flat().map((r) => r.h));
const totalStoredText = q("SELECT SUM(LENGTH(bytes)) b FROM vfs_content_blob")[0].b;
const totalStoredBin = [...blobs.keys()].reduce((s, h) => s + binSize(h), 0);
const totalPlainUnique = [...allUnique].reduce((s, h) => s + RAW(getPlain(h)), 0);
W("== 全库口径（按 content_hash 去重）==");
W(" blob 行 =", blobs.size, " active 版本引用到的 unique hash =", allUnique.size, " entries =", entries.size);
W(" 现状存储（文本口径，含 base64）=", MB(totalStoredText), "MB；折算二进制口径 =", MB(totalStoredBin), "MB");
W(" 去重后唯一明文合计 =", MB(totalPlainUnique), "MB；整体压缩比（二进制口径）= ", (totalPlainUnique / totalStoredBin).toFixed(2) + ":1");

// 多版本 entry（唯一 hash 数 >= 2）
let multiEntry = 0;
const rowsOut = [];
let baseIndep = 0, packBest = 0, headKept = 0, packGrouped = 0, singleOnly = 0;
const shortBucket = { base: 0, best: 0, n: 0 }, longBucket = { base: 0, best: 0, n: 0 };
const PACK_MAX_VERSIONS = 8, PACK_MAX_PLAIN = 1 << 20;
let groups = 0, maxPlain = 0, maxStream = 0;
for (const [eid, list] of byEntry) {
  const uniq = [...new Set(list.map((r) => r.h))];
  if (uniq.length < 2) { singleOnly += uniq.reduce((s, h) => s + binSize(h), 0); continue; }
  multiEntry++;
  const base = uniq.reduce((s, h) => s + binSize(h), 0);
  const best = Z(uniq.map(getPlain).join(""));
  baseIndep += base; packBest += best;
  const allShort = uniq.every((h) => RAW(getPlain(h)) <= 32768);
  const b = allShort ? shortBucket : longBucket;
  b.base += base; b.best += best; b.n++;

  // 分组打包模拟：head 版本保持独立，其余按唯一 hash 分组
  const head = entries.get(eid)?.hv;
  const headHash = list.find((r) => r.v === head)?.h;
  const keepHead = headHash && uniq.includes(headHash);
  const rest = uniq.filter((h) => h !== headHash);
  if (keepHead) headKept += binSize(headHash);
  let buf = [], bufPlain = 0;
  const flush = () => {
    if (!buf.length) return;
    const s = Z(buf.join(""));
    packGrouped += s; groups++;
    maxPlain = Math.max(maxPlain, bufPlain); maxStream = Math.max(maxStream, s);
    buf = []; bufPlain = 0;
  };
  for (const h of rest) {
    const p = getPlain(h), sz = RAW(p);
    if (buf.length && (buf.length >= PACK_MAX_VERSIONS || bufPlain + sz > PACK_MAX_PLAIN)) flush();
    buf.push(p); bufPlain += sz;
  }
  flush();
  rowsOut.push({ eid, v: list.length, u: uniq.length, base, best, path: entries.get(eid)?.p });
}
rowsOut.sort((a, b) => b.base - a.base);
W("\n== 多版本 entry（unique hash >= 2）==");
W(" count =", multiEntry, " 单版本 entry 部分存储 =", MB(singleOnly), "MB");
W(" 独立压（去重后）= ", MB(baseIndep), "MB → 全链单流（理论极限）= ", MB(packBest), "MB  省 ", MB(baseIndep - packBest),
  "MB /", (((baseIndep - packBest) / baseIndep) * 100).toFixed(1) + "%");
W(" 分组 pack（<=8 版本/<=1MB，head 保持独立）= ", MB(packGrouped), "MB + head ", MB(headKept), "MB = ", MB(packGrouped + headKept),
  "MB  省 ", MB(baseIndep - packGrouped), "MB /", (((baseIndep - packGrouped) / baseIndep) * 100).toFixed(1) + "%");
W(" 组数 =", groups, " 单组最大明文 =", (maxPlain / 1024).toFixed(0) + "KB 单组最大流 =", (maxStream / 1024).toFixed(0) + "KB");
W(" 拆分：全版本<=32KB 的 entry n=" + shortBucket.n, MB(shortBucket.base), "->", MB(shortBucket.best),
  "省 " + (((shortBucket.base - shortBucket.best) / Math.max(1, shortBucket.base)) * 100).toFixed(1) + "%");
W("      含>32KB 版本的 entry n=" + longBucket.n, MB(longBucket.base), "->", MB(longBucket.best),
  "省 " + (((longBucket.base - longBucket.best) / Math.max(1, longBucket.base)) * 100).toFixed(1) + "%");
W("\n top12:");
for (const r of rowsOut.slice(0, 12)) {
  W(`  eid=${r.eid} 版本=${r.v} 唯一=${r.u} 独立=${(r.base / 1024).toFixed(0)}KB 单流=${(r.best / 1024).toFixed(0)}KB ${r.path ?? ""}`);
}

// 全库合计（含单版本）
W("\n== 全库合计 ==");
const afterPack = singleOnly + packGrouped + headKept;
W(" 现状（二进制口径）= ", MB(totalStoredBin), "MB → pack 后 = ", MB(afterPack), "MB  省 ", MB(totalStoredBin - afterPack),
  "MB /", (((totalStoredBin - afterPack) / totalStoredBin) * 100).toFixed(1) + "%");
W(" 其中本次可达（multi-entry 部分）=", MB(baseIndep - packGrouped), "MB");

fs.writeFileSync("tmp/vfs-pack-measure2.out.txt", out.join("\n"), "utf8");
console.log("written tmp/vfs-pack-measure2.out.txt", out.length, "lines");
