// 字典链 vs pack：真库上的收益与读成本对比（跑完即弃）
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
const ZD = (s, d) => zlibSync(enc.encode(s), { level: 6, dictionary: enc.encode(d) }).byteLength;
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
for (const r of q("SELECT content_hash h, encoding e, bytes b, byte_len bl, LENGTH(bytes) tb FROM vfs_content_blob")) {
  blobs.set(r.h, { e: r.e, b: r.b, bl: r.bl, tb: r.tb });
}
const plainCache = new Map();
const P = (h) => {
  if (!plainCache.has(h)) plainCache.set(h, plainOf(blobs.get(h).e, blobs.get(h).b));
  return plainCache.get(h);
};
const binLen = (h) => (blobs.get(h).e === "zlib-b64" ? Math.round((blobs.get(h).tb * 3) / 4) : blobs.get(h).tb);

const revs = q("SELECT entry_id eid, version v, status st, content_hash h FROM vfs_revision ORDER BY entry_id, version");
const entries = new Map();
for (const r of q("SELECT entry_id id, scope_key sk, path p, head_version hv FROM vfs_entry")) entries.set(r.id, r);
const byEntry = new Map();
for (const r of revs) {
  if (r.st !== "active" || !r.h) continue;
  if (!byEntry.has(r.eid)) byEntry.set(r.eid, []);
  byEntry.get(r.eid).push(r);
}

let base = 0, chainFree = 0, heads = new Set();
const chains = [];
for (const [eid, list] of byEntry) {
  const uniq = [...new Set(list.map((r) => r.h))];
  if (uniq.length < 2) continue;
  const headHash = list.find((r) => r.v === entries.get(eid)?.hv)?.h;
  if (headHash) heads.add(headHash);
  base += uniq.reduce((s, h) => s + binLen(h), 0);
  chainFree += Z(uniq.map(P).join(""));
  chains.push({ eid, uniq });
}

W("== 基准（多版本 entry，去重后二进制口径）==");
W(" 独立压合计 =", MB(base), "MB   全链单流（pack 上限）=", MB(chainFree), "MB");
const headBin = [...heads].reduce((s, h) => s + binLen(h), 0);
W(" head 版本数 =", heads.size, " head 独立压合计 =", MB(headBin), "MB");

for (const MAXD of [1, 2, 4, 8, 16, 1e9]) {
  let total = 0, maxDepth = 0, sumDepth = 0, nDict = 0, nFull = 0;
  for (const c of chains) {
    let prevPlain = null, prevDepth = 0;
    for (const h of c.uniq) {
      const p = P(h);
      const isHead = heads.has(h);
      // 策略：head 恒独立；其余在深度未超限时用前一版本做字典
      if (isHead || prevPlain === null || prevDepth + 1 > MAXD) {
        total += Z(p); nFull++; prevDepth = 0;
      } else {
        total += ZD(p, prevPlain); nDict++; prevDepth = prevDepth + 1;
      }
      maxDepth = Math.max(maxDepth, prevDepth);
      sumDepth += prevDepth;
      prevPlain = p;
    }
  }
  W(`\n== 字典链（head 独立，MAXDEPTH=${MAXD === 1e9 ? "∞" : MAXD}）==`);
  W(" 总存储 =", MB(total), "MB  省", MB(base - total), "MB /", (((base - total) / base) * 100).toFixed(1) + "%",
    " 字典行 =", nDict, " 独立行 =", nFull);
  W(" 最深链 =", maxDepth, " 平均深度 =", (sumDepth / (nDict + nFull)).toFixed(2));
}

// pack 参照（<=8 版本 / <=1MB 一组，head 独立）
const MAXV = 8, MAXP = 1 << 20;
let pack = 0, groups = 0, maxStream = 0;
for (const c of chains) {
  const headHash = [...c.uniq].find((h) => heads.has(h));
  let buf = [], bp = 0;
  const flush = () => {
    if (!buf.length) return;
    const s = Z(buf.join(""));
    pack += s; groups++; maxStream = Math.max(maxStream, s);
    buf = []; bp = 0;
  };
  for (const h of c.uniq) {
    if (h === headHash) continue;
    const p = P(h), sz = RAW(p);
    if (buf.length && (buf.length >= MAXV || bp + sz > MAXP)) flush();
    buf.push(p); bp += sz;
  }
  flush();
}
W("\n== pack 参照（head 独立，<=8 版本/<=1MB 一组）==");
W(" pack 流 =", MB(pack), "MB + head", MB(headBin), "MB =", MB(pack + headBin), "MB  省", MB(base - pack), "MB /",
  (((base - pack) / base) * 100).toFixed(1) + "%  组数 =", groups, " 单组最大流 =", (maxStream / 1024).toFixed(0) + "KB");

fs.writeFileSync("tmp/dict-vs-pack.out.txt", out.join("\n"), "utf8");
console.log("written tmp/dict-vs-pack.out.txt");
