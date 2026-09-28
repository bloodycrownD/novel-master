// v3：修正二进制口径（用 LENGTH(bytes) 而非 byte_len）+ 统计 byte_len 写法约定（跑完即弃）
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

// byte_len 写法约定统计
W("== byte_len 约定统计（vfs_content_blob）==");
for (const r of q(`SELECT encoding e, COUNT(*) n,
   SUM(CASE WHEN byte_len = LENGTH(bytes) THEN 1 ELSE 0 END) eq_text_len,
   SUM(CASE WHEN byte_len = CAST(LENGTH(bytes)*3/4 AS INT) THEN 1 ELSE 0 END) eq_bin_len,
   SUM(CASE WHEN byte_len = LENGTH(bytes)*3/4-2 THEN 1 ELSE 0 END) eq_bin_len2,
   SUM(LENGTH(bytes)) text_bytes, SUM(byte_len) blen
   FROM vfs_content_blob GROUP BY 1`)) W(" ", r);

const blobs = new Map();
for (const r of q("SELECT content_hash h, encoding e, bytes b, byte_len bl, LENGTH(bytes) tb FROM vfs_content_blob")) {
  blobs.set(r.h, { e: r.e, b: r.b, bl: r.bl, tb: r.tb, plain: null });
}
const getPlain = (h) => {
  const b = blobs.get(h);
  if (b.plain === null) b.plain = plainOf(b.e, b.b);
  return b.plain;
};
const textLen = (h) => blobs.get(h).tb;
const binLen = (h) => (blobs.get(h).e === "zlib-b64" ? Math.round((textLen(h) * 3) / 4) : textLen(h));

const revs = q("SELECT entry_id eid, version v, status st, content_hash h FROM vfs_revision ORDER BY entry_id, version");
const entries = new Map();
for (const r of q("SELECT entry_id id, scope_key sk, path p, content_hash h, head_version hv FROM vfs_entry")) entries.set(r.id, r);
const byEntry = new Map();
for (const r of revs) {
  if (r.st !== "active" || !r.h) continue;
  if (!byEntry.has(r.eid)) byEntry.set(r.eid, []);
  byEntry.get(r.eid).push(r);
}

const allHashes = [...blobs.keys()];
const totalText = allHashes.reduce((s, h) => s + textLen(h), 0);
const totalBin = allHashes.reduce((s, h) => s + binLen(h), 0);
const totalPlain = allHashes.reduce((s, h) => s + RAW(getPlain(h)), 0);
W("\n== 全库（unique hash）==");
W(" rows =", allHashes.length, " 原文合计 =", MB(totalPlain), "MB");
W(" 现状存储 =", MB(totalText), "MB（含 base64 文本） → 去 base64 后 =", MB(totalBin), "MB  省", MB(totalText - totalBin), "MB");
W(" 二进制口径压缩比 =", (totalPlain / totalBin).toFixed(2) + ":1");

// 分类：多版本 entry 命中的 hash 集合
const multiSet = new Set();
const headSet = new Set();
let multiEntry = 0;
for (const [eid, list] of byEntry) {
  const uniq = [...new Set(list.map((r) => r.h))];
  if (uniq.length < 2) continue;
  multiEntry++;
  uniq.forEach((h) => multiSet.add(h));
  const headHash = list.find((r) => r.v === entries.get(eid)?.hv)?.h;
  if (headHash) headSet.add(headHash);
}
const multiHashes = [...multiSet];
const singleHashes = allHashes.filter((h) => !multiSet.has(h));
const mBase = multiHashes.reduce((s, h) => s + binLen(h), 0);
const sBase = singleHashes.reduce((s, h) => s + binLen(h), 0);
W("\n== 分类（按 hash 是否属于多版本 entry，去重后不重复计数）==");
W(" 多版本 entry =", multiEntry, " 命中 hash =", multiHashes.length, " 其二进制独立压 =", MB(mBase), "MB");
W(" 其余 hash =", singleHashes.length, " 其二进制 =", MB(sBase), "MB");
W(" 合计 =", MB(mBase + sBase), "MB（应等于", MB(totalBin), "）");

// 全链单流（理论上限）
let chainStream = 0;
for (const [eid, list] of byEntry) {
  const uniq = [...new Set(list.map((r) => r.h))];
  if (uniq.length < 2) continue;
  chainStream += Z(uniq.map(getPlain).join(""));
}
// 分组 pack：head 独立，其余 <=8 版本/<=1MB 一组
const PACK_MAX_VERSIONS = 8, PACK_MAX_PLAIN = 1 << 20;
let packStream = 0, groups = 0, maxPlain = 0, maxStream = 0;
const headKeptHashes = new Set();
for (const [eid, list] of byEntry) {
  const uniq = [...new Set(list.map((r) => r.h))];
  if (uniq.length < 2) continue;
  const headHash = list.find((r) => r.v === entries.get(eid)?.hv)?.h;
  if (headHash && uniq.includes(headHash)) headKeptHashes.add(headHash);
  let buf = [], bufPlain = 0;
  const flush = () => {
    if (!buf.length) return;
    const s = Z(buf.join(""));
    packStream += s; groups++;
    maxPlain = Math.max(maxPlain, bufPlain); maxStream = Math.max(maxStream, s);
    buf = []; bufPlain = 0;
  };
  for (const h of uniq) {
    if (h === headHash) continue;
    const p = getPlain(h), sz = RAW(p);
    if (buf.length && (buf.length >= PACK_MAX_VERSIONS || bufPlain + sz > PACK_MAX_PLAIN)) flush();
    buf.push(p); bufPlain += sz;
  }
  flush();
}
const headKeptBin = [...headKeptHashes].reduce((s, h) => s + binLen(h), 0);
W("\n== pack 结果（二进制口径）==");
W(" 多版本 hash 独立压 =", MB(mBase), "MB → 全链单流 =", MB(chainStream), "MB（省", MB(mBase - chainStream), "MB /",
  (((mBase - chainStream) / mBase) * 100).toFixed(1) + "%）");
W(" 分组 pack 流 =", MB(packStream), "MB + 独立 head =", MB(headKeptBin), "MB =", MB(packStream + headKeptBin), "MB（省",
  MB(mBase - packStream), "MB /", (((mBase - packStream) / mBase) * 100).toFixed(1) + "%）");
W(" 组数 =", groups, " 单组最大明文 =", (maxPlain / 1024).toFixed(0) + "KB 单组最大流 =", (maxStream / 1024).toFixed(0) + "KB");
W("\n== 全库总量预测 ==");
W(" 现状二进制口径 =", MB(totalBin), "MB（文本口径", MB(totalText), "MB）");
W(" 去 base64 + pack 后 =", MB(sBase + packStream + headKeptBin), "MB");
W(" 相对现状文本口径省 =", MB(totalText - (sBase + packStream + headKeptBin)), "MB /",
  (((totalText - (sBase + packStream + headKeptBin)) / totalText) * 100).toFixed(1) + "%");
W(" 其中去 base64 贡献 =", MB(totalText - totalBin), "MB，pack 贡献 =", MB(mBase - packStream), "MB");

fs.writeFileSync("tmp/vfs-pack-measure3.out.txt", out.join("\n"), "utf8");
console.log("written tmp/vfs-pack-measure3.out.txt");
