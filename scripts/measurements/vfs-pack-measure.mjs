// 只为 SPEC 取数的临时脚本（跑完即弃）：真库副本上复核 VFS pack/delta 口径与 base64 规模
// 输出写 tmp/vfs-pack-measure.out.txt（UTF-8），避免 GBK 控制台乱码
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

const bad = [];
function plainOf(encoding, bytes, hash) {
  const isStr = typeof bytes === "string";
  const u8 = isStr ? null : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const asText = isStr ? bytes : dec.decode(u8);
  const tries = [];
  if (encoding === "zlib") {
    tries.push(["zlib/bin", () => (isStr ? b64ToBytes(bytes) : u8)]);
    if (!isStr) tries.push(["zlib/text-b64", () => b64ToBytes(asText.trim())]);
  } else if (encoding === "zlib-b64") {
    tries.push(["b64/text", () => b64ToBytes(asText.trim())]);
    if (isStr) tries.push(["b64/str-as-binary", () => new TextEncoder().encode(bytes)]);
  }
  for (const [label, get] of tries) {
    try {
      return dec.decode(unzlibSync(get()));
    } catch (e) {
      bad.push({ hash, encoding, typeof: isStr ? "text" : u8.constructor.name, len: isStr ? bytes.length : u8.byteLength,
        label, err: String(e && e.message) });
    }
  }
  return null;
}

W("== user_version ==", q("PRAGMA user_version")[0].user_version);
const cols = (t) => q(`PRAGMA table_info(${t})`).map((c) => c.name);
W("chat_message cols has content_encoding:", cols("chat_message").includes("content_encoding"));

// ---------- F1：chat_message 明文规模 → 压缩后二进制 / b64 两形态 ----------
let plainBytes = 0, binTotal = 0, b64Total = 0, msgCount = 0;
const rows = q("SELECT content_json c FROM chat_message WHERE COALESCE(content_json,'') != ''");
for (const r of rows) {
  msgCount++;
  const raw = RAW(r.c);
  const bin = Z(r.c);
  plainBytes += raw; binTotal += bin; b64Total += Math.ceil(bin / 3) * 4;
}
W("\n== F1 chat_message（迁移前副本，全部明文行）==");
W(" rows =", msgCount, " plaintext =", MB(plainBytes), "MB");
W(" 压缩后二进制合计 =", MB(binTotal), "MB", " 压缩比 =", (plainBytes / binTotal).toFixed(2) + ":1");
W(" 若按 zlib-b64 存（base64 文本）=", MB(b64Total), "MB", " 压缩比 =", (plainBytes / b64Total).toFixed(2) + ":1");
W(" 去 base64 可省 =", MB(b64Total - binTotal), "MB", "（占二进制口径 +" + (((b64Total / binTotal) - 1) * 100).toFixed(1) + "%）");

// ---------- F1：vfs_content_blob / session_file_cache_blob 规模 ----------
W("\n== F1 vfs_content_blob / session_file_cache_blob 按 encoding / TYPEOF ==");
for (const t of ["vfs_content_blob", "session_file_cache_blob"]) {
  for (const r of q(`SELECT encoding e, TYPEOF(bytes) t, COUNT(*) n, SUM(LENGTH(bytes)) bytes, SUM(byte_len) blen FROM ${t} GROUP BY 1,2`)) {
    W(" " + t, r);
  }
}

// ---------- VFS 版本链解码 ----------
const blobs = new Map();
for (const r of q("SELECT content_hash h, encoding e, bytes b, byte_len bl FROM vfs_content_blob")) {
  blobs.set(r.h, { e: r.e, b: r.b, bl: r.bl });
}
const revs = q("SELECT entry_id eid, version v, status st, content_hash h FROM vfs_revision ORDER BY entry_id, version");
const entries = new Map();
for (const r of q("SELECT entry_id id, scope_key sk, path p, content_hash h, head_version hv FROM vfs_entry")) {
  entries.set(r.id, r);
}
const byEntry = new Map();
for (const r of revs) {
  if (r.st !== "active" || !r.h) continue;
  if (!byEntry.has(r.eid)) byEntry.set(r.eid, []);
  byEntry.get(r.eid).push(r);
}
W("\n== VFS 规模 ==");
W(" entries =", entries.size, " active revisions(hash) =", revs.filter((r) => r.st === "active" && r.h).length,
  " deleted revs =", revs.filter((r) => r.st === "deleted").length, " blob rows =", blobs.size);
W(" 引用不到 blob 行的 active revision 数 =", [...byEntry.values()].flat().filter((r) => !blobs.has(r.h)).length);

let multi = 0, indepAll = 0, concatAll = 0, plainAll = 0;
const shortOnly = { indep: 0, concat: 0, n: 0 }, hasLong = { indep: 0, concat: 0, n: 0 };
const details = [];
for (const [eid, list] of byEntry) {
  if (list.length < 2) continue;
  multi++;
  const pls = list.map((r) => plainOf(blobs.get(r.h).e, blobs.get(r.h).b, r.h));
  if (pls.some((p) => p === null)) { W(" !!! decode failed in entry", eid, "versions", list.map((r) => r.v).join(",")); continue; }
  const indep = list.reduce((s, r) => s + blobs.get(r.h).bl, 0);
  const concat = Z(pls.join(""));
  const plain = pls.reduce((s, p) => s + RAW(p), 0);
  indepAll += indep; concatAll += concat; plainAll += plain;
  const allShort = pls.every((p) => RAW(p) <= 32768);
  const b = allShort ? shortOnly : hasLong;
  b.indep += indep; b.concat += concat; b.n++;
  details.push({ eid, path: entries.get(eid)?.p, n: list.length, indep, concat, plain, maxV: Math.max(...pls.map(RAW)) });
}
details.sort((a, b) => b.indep - a.indep);
W("\n== 多版本 entry（>=2 active 版本） ==");
W(" count =", multi, " plaintext =", MB(plainAll), "MB", " independent =", MB(indepAll), "MB", " concat(deflate) =", MB(concatAll), "MB",
  " saving =", (((indepAll - concatAll) / indepAll) * 100).toFixed(1) + "%");
W(" 全版本<=32KB 的 entry: n=" + shortOnly.n, MB(shortOnly.indep), "->", MB(shortOnly.concat),
  " saving=" + (((shortOnly.indep - shortOnly.concat) / Math.max(1, shortOnly.indep)) * 100).toFixed(1) + "%");
W(" 含>32KB 版本的 entry: n=" + hasLong.n, MB(hasLong.indep), "->", MB(hasLong.concat),
  " saving=" + (((hasLong.indep - hasLong.concat) / Math.max(1, hasLong.indep)) * 100).toFixed(1) + "%");
W("\n top10 multi-version entry:");
for (const d of details.slice(0, 10)) {
  W(`  eid=${d.eid} v=${d.n} plain=${(d.plain / 1024).toFixed(0)}KB indep=${(d.indep / 1024).toFixed(0)}KB concat=${(d.concat / 1024).toFixed(0)}KB maxVersion=${(d.maxV / 1024).toFixed(0)}KB ${d.path ?? ""}`);
}

// ---------- pack 方案模拟：排除 head 版本 + 分组（<=8 版本 / <=1MB 明文） ----------
for (const [MAXV, MAXP] of [[8, 1 << 20], [8, 1 << 19], [16, 1 << 20], [4, 1 << 19]]) {
  let packSim = 0, packKept = 0, groups = 0, maxPlain = 0, maxStream = 0;
  for (const [eid, list] of byEntry) {
    if (list.length < 2) continue;
    const head = entries.get(eid)?.hv;
    const keptRow = list.find((r) => r.v === head);
    if (keptRow) packKept += blobs.get(keptRow.h).bl;
    let buf = [], bufPlain = 0;
    const flush = () => {
      if (!buf.length) return;
      const stream = Z(buf.join(""));
      packSim += stream; groups++;
      maxPlain = Math.max(maxPlain, bufPlain); maxStream = Math.max(maxStream, stream);
      buf = []; bufPlain = 0;
    };
    for (const r of list) {
      if (r.v === head) continue;
      const p = plainOf(blobs.get(r.h).e, blobs.get(r.h).b, r.h);
      if (p === null) continue;
      const sz = RAW(p);
      if (buf.length && (buf.length >= MAXV || bufPlain + sz > MAXP)) flush();
      buf.push(p); bufPlain += sz;
    }
    flush();
  }
  W(`\n== pack 模拟 maxVersions=${MAXV} maxPlain=${(MAXP / 1024).toFixed(0)}KB ==`);
  W(" groups =", groups, " pack stream total =", MB(packSim), "MB", " kept-head standalone =", MB(packKept), "MB");
  W(" 预计 vfs_content_blob 侧总量 =", MB(packSim + packKept), "MB（现状 multi-entry 独立压 =", MB(indepAll), "MB）",
    " 省 =", MB(indepAll - packSim), "MB /", (((indepAll - packSim) / indepAll) * 100).toFixed(1) + "%");
  W(" 单组最大明文 =", (maxPlain / 1024).toFixed(0) + "KB", " 单组最大流 =", (maxStream / 1024).toFixed(0) + "KB");
}

const totalStored = q("SELECT SUM(LENGTH(bytes)) b FROM vfs_content_blob")[0].b;
W("\n== vfs_content_blob 总存储 =", MB(totalStored), "MB（其中 multi-entry 独立压部分 =", MB(indepAll), "MB）");

W("\n== 解码失败/走兜底分支的样本（前 12 条）==");
W(" 失败次数 =", bad.filter((b) => b.err).length, " 兜底命中次数 =", bad.filter((b) => !b.err).length);
const seen = new Set();
for (const b of bad) {
  const k = b.encoding + "|" + b.typeof + "|" + b.label;
  if (seen.has(k)) continue;
  seen.add(k);
  W("  sample:", k, JSON.stringify({ hash: String(b.hash).slice(0, 12), len: b.len, err: b.err ?? "(ok, fallback worked)" }));
}

fs.writeFileSync("tmp/vfs-pack-measure.out.txt", out.join("\n"), "utf8");
console.log("written tmp/vfs-pack-measure.out.txt", out.length, "lines");
