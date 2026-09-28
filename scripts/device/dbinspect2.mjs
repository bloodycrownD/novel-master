import Database from "better-sqlite3";
const db = new Database(process.argv[2], { readonly: true });
const q = (sql) => db.prepare(sql).all();

console.log("== user_version ==", q("PRAGMA user_version")[0].user_version);
console.log("== schema_migrations ==", q("SELECT * FROM schema_migrations").map(r => JSON.stringify(r)).join("\n"));

console.log("\n== session_run_state 全行 ==");
for (const r of q("SELECT session_id, run_id, status, text_chars, thinking_chars, LENGTH(COALESCE(partial_text,'')) pt_len, LENGTH(COALESCE(partial_thinking,'')) pth_len, started_at_ms, updated_at_ms FROM session_run_state")) {
  console.log(JSON.stringify(r));
}

console.log("\n== chat_session ==");
for (const r of q("SELECT id, created_at_ms, agent_config_json IS NOT NULL has_agent_cfg, composer_draft_json IS NOT NULL has_draft, LENGTH(COALESCE(composer_draft_json,'')) draft_len FROM chat_session")) {
  console.log(JSON.stringify(r));
}

console.log("\n== 21KB user 消息所在会话(792f)全消息 ==");
for (const r of q("SELECT seq, role, hidden, LENGTH(COALESCE(content_json,'')) len, LENGTH(COALESCE(attachments_json,'')) att_len, created_at_ms FROM chat_message WHERE session_id='792fcd51-004c-4b76-b1e7-0dd631a5f7a8' ORDER BY seq")) {
  console.log(JSON.stringify(r));
}

console.log("\n== e943 会话全消息（36条最大会话） ==");
for (const r of q("SELECT seq, role, hidden, LENGTH(COALESCE(content_json,'')) len, LENGTH(COALESCE(attachments_json,'')) att_len FROM chat_message WHERE session_id='e943a2b7-047f-4340-8a31-aba3bc7699a0' ORDER BY seq")) {
  console.log(JSON.stringify(r));
}

console.log("\n== checkpoint 分布 ==");
for (const r of q("SELECT session_id, COUNT(*) cnt FROM message_checkpoint GROUP BY session_id")) {
  console.log(JSON.stringify(r));
}

console.log("\n== 21KB user 消息内容采样（前600字符） ==");
const big = q("SELECT content_json FROM chat_message WHERE session_id='792fcd51-004c-4b76-b1e7-0dd631a5f7a8' AND seq=3")[0];
console.log(String(big.content_json).slice(0, 600));

console.log("\n== vfs_entry/vfs_revision 规模（回滚恢复树成本） ==");
console.log(JSON.stringify(q("SELECT COUNT(*) entries FROM vfs_entry")[0]), JSON.stringify(q("SELECT COUNT(*) revs FROM vfs_revision")[0]));
