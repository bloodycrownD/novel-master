// 真机库（A1 去 base64 之后）只读校验：形态 / byte_len / KKV 标记 / 逐哈希与迁移前副本比对 / 消息表未波及
// 用法：node tmp/verify-device-db.mjs <deviceDbPath> [baselinePath]
import Database from "better-sqlite3";
import { zlibSync, unzlibSync } from "fflate";
import { createHash } from "node:crypto";
import fs from "node:fs";

const devicePath = process.argv[2];
const baselinePath = process.argv[3] ?? "tmp/nm-real.db";
const out = [];
const W = (...a) => out.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));

const b64ToBytes = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const dec = new TextDecoder("utf-8");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

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

const dev = new Database(devicePath, { readonly: true });
const q = (db, sql) => db.prepare(sql).all();

W("== 真机库 ==", devicePath, " bytes =", fs.statSync(devicePath).size);
W("PRAGMA user_version =", q(dev, "PRAGMA user_version")[0].user_version, " integrity_check =", q(dev, "PRAGMA integrity_check")[0].integrity_check);

// 1) 两张表形态
W("\n== 形态（期望 encoding 全 zlib、TYPEOF 全 blob、byte_len = LENGTH(bytes)）==");
for (const t of ["vfs_content_blob", "session_file_cache_blob"]) {
  for (const r of q(dev, `SELECT encoding e, TYPEOF(bytes) t, COUNT(*) n, SUM(LENGTH(bytes)) bytes, SUM(byte_len) blen FROM ${t} GROUP BY 1,2`)) {
    W(" " + t, r);
  }
  const m = q(dev, `SELECT
     SUM(CASE WHEN encoding <> 'zlib' THEN 1 ELSE 0 END) bad_enc,
     SUM(CASE WHEN TYPEOF(bytes) <> 'blob' THEN 1 ELSE 0 END) bad_type,
     SUM(CASE WHEN byte_len <> LENGTH(bytes) THEN 1 ELSE 0 END) bad_len,
     SUM(CASE WHEN encoding = 'zlib-b64' OR (encoding = 'zlib' AND TYPEOF(bytes) = 'text') THEN 1 ELSE 0 END) pending,
     COUNT(*) n FROM ${t}`)[0];
  W(" " + t + " 断言", m);
}

// 2) KKV 完成标记
W("\n== KKV nm-blob-binary ==");
W(" ", q(dev, "SELECT module, key, value FROM kkv_entry WHERE module = 'nm-blob-binary'"));

// 3) 逐哈希与迁移前副本比对（vfs 的 content_hash = sha256(明文)，可直接验）
const base = new Database(baselinePath, { readonly: true });
let checked = 0, mismatch = 0, missing = 0;
const baseHashes = new Map();
for (const r of q(base, "SELECT content_hash h, encoding e, bytes b FROM vfs_content_blob")) baseHashes.set(r.h, { e: r.e, b: r.b });
for (const r of q(dev, "SELECT content_hash h, encoding e, bytes b FROM vfs_content_blob")) {
  const b = baseHashes.get(r.h);
  if (!b) { continue; }
  const p = plainOf(r.e, r.b);
  if (sha(p) !== r.h) mismatch += 1;
  checked += 1;
}
W("\n== vfs 逐哈希（真机 vs 迁移前副本）==", " 覆盖", checked, "/", baseHashes.size, " sha 不符", mismatch);

// 4) 解压全量体检 + 大小对比
let devPlain = 0, devStored = 0, bad = 0;
for (const r of q(dev, "SELECT encoding e, bytes b, byte_len bl FROM vfs_content_blob")) {
  try {
    devPlain += Buffer.byteLength(plainOf(r.e, r.b), "utf8");
    devStored += r.bl;
  } catch { bad += 1; }
}
let basePlain = 0, baseStored = 0;
for (const [, v] of baseHashes) {
  try {
    const p = plainOf(v.e, v.b);
    basePlain += Buffer.byteLength(p, "utf8");
    baseStored += v.e === "zlib-b64" ? Buffer.byteLength(typeof v.b === "string" ? v.b : dec.decode(v.b), "utf8") : v.b.byteLength;
  } catch { /* ignore */ }
}
W("== vfs 体积 ==", " 迁移前落库字节", baseStored, " -> 真机落库字节", devStored, " 明文合计(真机)", devPlain, " 解压失败", bad);

let fcBad = 0;
for (const r of q(dev, "SELECT encoding e, bytes b FROM session_file_cache_blob")) {
  try { plainOf(r.e, r.b); } catch { fcBad += 1; }
}
W("== file_cache 解压失败 ==", fcBad);

// 5) 消息表未波及（A1 不该碰 chat_message）
const msg = q(dev, `SELECT
   COUNT(*) n,
   SUM(CASE WHEN COALESCE(content_json,'') = '' THEN 1 ELSE 0 END) empty_json,
   SUM(CASE WHEN content_encoding = 'zlib-b64' THEN 1 ELSE 0 END) b64_rows,
   SUM(CASE WHEN content_encoding = 'zlib' AND TYPEOF(content_blob)='blob' THEN 1 ELSE 0 END) bin_rows
   FROM chat_message`)[0];
W("\n== chat_message（应仍是 mcdev 迁移后的形态：empty_json 全空 + b64_rows 占多数）==");
W(" ", msg);

fs.writeFileSync("tmp/verify-device-db.out.txt", out.join("\n"), "utf8");
console.log("written tmp/verify-device-db.out.txt");
