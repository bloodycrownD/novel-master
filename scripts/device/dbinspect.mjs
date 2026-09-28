// 只读探查用户的 nmbackup.db：验证回滚卡顿/不刷新病灶的前提条件
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

const path = process.argv[2];
const db = new Database(path, { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
console.log("== tables ==", tables.join(","));

const q = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return [{ ERR: e.message.slice(0, 120) }]; } };

console.log("\n== 会话规模 TOP10（消息数/总字节） ==");
for (const r of q(`SELECT s.id sid, COUNT(m.id) cnt, SUM(LENGTH(COALESCE(m.content_json,''))) bytes
  FROM chat_message m JOIN chat_session s ON s.id = m.session_id GROUP BY m.session_id
  ORDER BY bytes DESC LIMIT 10`)) {
  console.log(r.sid, "msgs=", r.cnt, "bytes=", r.bytes);
}

console.log("\n== 消息 role 列存在性与 user 消息长度 TOP10 ==");
const cols = q("PRAGMA table_info(chat_message)").map(c => c.name);
console.log("chat_message cols:", cols.join(","));
const roleCol = cols.includes("role") ? "role" : null;
if (roleCol) {
  for (const r of q(`SELECT session_id, seq, role, LENGTH(COALESCE(content_json,'')) len
    FROM chat_message WHERE role='user' ORDER BY len DESC LIMIT 10`)) {
    console.log("user msg len=", r.len, "sid=", r.session_id, "seq=", r.seq);
  }
  console.log("\n== role 分布与字节 ==");
  for (const r of q(`SELECT role, COUNT(*) cnt, SUM(LENGTH(COALESCE(content_json,''))) bytes FROM chat_message GROUP BY role`)) {
    console.log(r.role, "cnt=", r.cnt, "bytes=", r.bytes);
  }
}

console.log("\n== run 状态（找 interrupted 现场） ==");
const runTables = tables.filter(t => /run|stream|unit/i.test(t));
for (const t of runTables) {
  const c = q(`PRAGMA table_info(${t})`).map(x => x.name);
  console.log(`-- ${t}: ${c.join(",")}`);
}

console.log("\n== kkv run_state 域 ==");
for (const r of q(`SELECT * FROM kkv_entry WHERE module LIKE '%run%' OR module LIKE '%stream%' LIMIT 5`)) {
  console.log(r.module, r.key, String(r.value).slice(0, 100));
}

console.log("\n== 单条最大消息 TOP10（不分 role） ==");
for (const r of q(`SELECT session_id, seq, ${roleCol ?? "''"} role, LENGTH(COALESCE(content_json,'')) len
  FROM chat_message ORDER BY len DESC LIMIT 10`)) {
  console.log("len=", r.len, "sid=", r.session_id, "seq=", r.seq, "role=", r.role);
}

console.log("\n== 各表行数 ==");
for (const t of tables) {
  const r = q(`SELECT COUNT(*) c FROM ${t}`);
  if (!r[0]?.ERR) console.log(t, r[0].c);
}
