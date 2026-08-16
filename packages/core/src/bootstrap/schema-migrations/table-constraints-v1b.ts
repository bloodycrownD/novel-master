/**
 * table-constraints-v1：全库表设计约束补全（NOT NULL / CHECK / WITHOUT ROWID / UNIQUE / json_valid）。
 *
 * 覆盖 findings 发现 20、21、22、23、24、25、26、27、28 + 下界 CHECK（P2-3）。一条 migration
 * 按表逐个 rebuild（参照 `vfs-entry-id-redesign-v1` 模式），rebuild 前先跑脏值预扫描并清洗
 * 成合法默认值，避免 `INSERT INTO _new SELECT * FROM` 撞上新加的约束。
 *
 * 同时 canonical DDL 已改成带约束形态、`SCHEMA_BOOT_VERSION` 5→6——本 migration 只负责把
 * 老库（v1.4.08+，已走过 entry-id migration）搬进新形态。新库 bootstrap 直接建成带约束形态，
 * 本 migration 的 `up` 靠 `vfs_revision` 是否已 `WITHOUT ROWID` 探测后 no-op。
 *
 * 决策 4：`vfs_revision` 切 `WITHOUT ROWID` 前，生产代码 `deleteUnreferencedUnderScope` 的
 * `WHERE rowid IN (...)` 已改写成 `WHERE (entry_id, version) IN (...)`（见对应 repository），
 * 所以这里 rebuild 后 GC 不会炸。
 *
 * 幂等：开头探测 `vfs_revision` 是否已 `WITHOUT ROWID`，已是目标形态则整个 `up` 直接 return。
 * 整条 migration 在 bootstrap 事务内跑，中途失败会整体回滚，不会留下半成品形态。
 *
 * @module bootstrap/schema-migrations/table-constraints-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  VFS_REVISION_INSERT_TRIGGER_DDL,
  VFS_REVISION_DELETE_TRIGGER_DDL,
  VFS_REVISION_UPDATE_TRIGGER_DDL,
} from "../vfs/vfs-revision-schema.js";
import type { SchemaMigration } from "./schema-migration.types.js";

/**
 * id 带 b 后缀：v1 在个别真机上因 disk I/O error 中间态被误标记 applied
 * （up 早退但 rebuild 未执行），升 id 让这类库重跑；已完成的库探测到
 * WITHOUT ROWID 后 no-op，三态安全。
 */
export const TABLE_CONSTRAINTS_V1_ID = "table-constraints-v1b";

/**
 * 探测 vfs_revision 是否已是 WITHOUT ROWID 形态（即本 migration 是否已 apply）。
 *
 * 用 sqlite_master 的建表 SQL 里是否含 `WITHOUT ROWID` 作判据——CHECK 约束名等不够稳定，
 * 而 WITHOUT ROWID 是本 migration 独有的形态变化（canonical DDL 之外没有别处会改它）。
 */
async function isAlreadyConstrained(tx: TdbcConnection): Promise<boolean> {
  const rows = await tx.query<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vfs_revision'`,
  );
  if (rows.length === 0 || rows[0]?.sql == null) {
    // 查询异常/空结果的保守方向是 false（重跑）：rebuild 幂等、重复执行无害；
    // 误判 true 会让约束永远缺失（真机事故：disk I/O error 后中间态下探测异常，
    // up 早退却标记 applied，16 表 rebuild 从未执行）。
    console.warn(
      "[table-constraints-v1] 探测 vfs_revision 形态失败（sqlite_master 无结果），按未迁移处理",
    );
    return false;
  }
  return /WITHOUT\s+ROWID/i.test(String(rows[0]?.sql ?? ""));
}

/**
 * 清洗脏值：对 `UPDATE table SET setSql WHERE whereSql` 命中的行打 warning 并改写。
 *
 * `setSql` / `whereSql` 均为硬编码 SQL 片段（含字面量），不接外部输入，无注入风险。
 *
 * @returns 被清洗的行数
 */
async function clean(
  tx: TdbcConnection,
  table: string,
  setSql: string,
  whereSql: string,
): Promise<number> {
  const rows = await tx.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${whereSql}`,
  );
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) {
    console.warn(
      `[table-constraints-v1] ${table}: 清洗 ${n} 条脏值（${whereSql} → ${setSql}）`,
    );
    await tx.execute(`UPDATE ${table} SET ${setSql} WHERE ${whereSql}`);
  }
  return n;
}

/**
 * 删除指定条件的行（用于 NULL PK、孤儿 FK 等无法用默认值兜底的情况）。
 *
 * @returns 被删除的行数
 */
async function discard(
  tx: TdbcConnection,
  table: string,
  whereSql: string,
): Promise<number> {
  const rows = await tx.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${whereSql}`,
  );
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) {
    console.warn(
      `[table-constraints-v1] ${table}: 丢弃 ${n} 条无法清洗的脏行（${whereSql}）`,
    );
    await tx.execute(`DELETE FROM ${table} WHERE ${whereSql}`);
  }
  return n;
}

/**
 * regex_rule 的 (group_id, sort_order) 去重（findings 发现 27 预扫描）。
 *
 * 加 UNIQUE 前先把重复 sort_order 的行（保留每组首个、其余递增分配新值）改开，
 * 否则 rebuild 的 `INSERT INTO _new SELECT * FROM` 会撞 UNIQUE 失败。新值从该 group
 * 当前 MAX(sort_order)+1 开始递增，保证不与既有值冲突。
 */
async function dedupRegexSortOrder(tx: TdbcConnection): Promise<number> {
  const dups = await tx.query<{ group_id: string; sort_order: number }>(
    `SELECT group_id, sort_order
     FROM regex_rule
     GROUP BY group_id, sort_order
     HAVING COUNT(*) > 1`,
  );
  if (dups.length === 0) {
    return 0;
  }
  let fixed = 0;
  for (const d of dups) {
    const maxRows = await tx.query<{ m: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM regex_rule WHERE group_id = ?`,
      [String(d.group_id)],
    );
    let next = Number(maxRows[0]?.m ?? 0);
    const rows = await tx.query<{ rule_id: string }>(
      `SELECT rule_id FROM regex_rule
       WHERE group_id = ? AND sort_order = ?
       ORDER BY rule_id`,
      [String(d.group_id), Number(d.sort_order)],
    );
    // 首条保留原 sort_order，其余递增分配新值。
    for (let i = 1; i < rows.length; i++) {
      next += 1;
      await tx.execute(
        `UPDATE regex_rule SET sort_order = ? WHERE group_id = ? AND rule_id = ?`,
        [next, String(d.group_id), String(rows[i]!.rule_id)],
      );
      fixed++;
    }
  }
  if (fixed > 0) {
    console.warn(
      `[table-constraints-v1] regex_rule: 去重 ${fixed} 条冲突的 (group_id, sort_order)`,
    );
  }
  return fixed;
}

/**
 * rebuild 单张表：CREATE _new → INSERT 共有列 → DROP old → RENAME → 重建索引/触发器。
 *
 * `newBodyDdl` 是不含 `CREATE TABLE name` 前缀的表体，如 `(...列与约束...) WITHOUT ROWID`。
 *
 * INSERT 只搬「旧表与新表共有」的列（按旧表顺序取交集），缺失列由新表 DEFAULT/NULL 兜底。
 * 这样即使旧表列序不同或少几列（如尚未 align 的老库），也能安全搬运—— migration
 * 在 bootstrap 流程里跑在 alignSchemaColumns 之前，老库可能有列尚未补齐。
 */
async function rebuildTable(
  txOrig: TdbcConnection,
  table: string,
  newBodyDdl: string,
  recreateSqls: readonly string[] = [],
): Promise<void> {
  const tx = txOrig;
  const tmp = `${table}__nm_tc_new`;
  // 读旧表列名（顺序敏感，决定 INSERT 列序）。
  const oldCols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
  );
  const oldColNames = oldCols.map((r) => String(r.name));

  await tx.execute(`DROP TABLE IF EXISTS ${tmp}`);
  await tx.execute(`CREATE TABLE ${tmp} ${newBodyDdl}`);

  // 读新表列名，取交集（旧表有且新表也有的列）。
  const newCols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${tmp}')`,
  );
  const newColSet = new Set(newCols.map((r) => String(r.name)));
  const common = oldColNames.filter((c) => newColSet.has(c));
  const colList = common.map((c) => `"${c}"`).join(", ");

  // 旧表此刻仍是 rowid 表，按 rowid 游标分块搬运，而不是单条整表
  // `INSERT ... SELECT`。原因：
  // 1) quick-sqlite 的 async execute 对无 LIMIT 的整表 INSERT SELECT 会挂起
  //    （真机实测 promise 永远 pending）；分块后单条执行时间短，async 稳定。
  // 2) 不能改用逐条参数化 INSERT：真机实测 3 万行逐条同步执行霸占 JS 线程
  //    4 分钟以上，触发 ANR 被杀；块状 INSERT SELECT 是引擎内部搬运，快得多。
  // 3) 真机上曾疑似的「INSERT 报 disk I/O error」实为 recreateSql 里的冗余索引
  //    CREATE INDEX 所致（WITHOUT ROWID 表 + CREATE INDEX 触发，见 up 头部注释），
  //    冗余索引已移除，搬运本身在真机验证稳定。
  const COPY_CHUNK = 100;
  let cursor = -1;
  for (;;) {
    const batch = await tx.query<{ r: number | bigint }>(
      `SELECT rowid AS r FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ${COPY_CHUNK}`,
      [cursor],
    );
    if (batch.length === 0) {
      break;
    }
    const lo = Number(batch[0]!.r);
    const hi = Number(batch[batch.length - 1]!.r);
    await tx.execute(
      `INSERT INTO ${tmp} (${colList}) SELECT ${colList} FROM ${table} WHERE rowid >= ? AND rowid <= ?`,
      [lo, hi],
    );
    cursor = hi;
  }

  await tx.execute(`DROP TABLE ${table}`);
  await tx.execute(`ALTER TABLE ${tmp} RENAME TO ${table}`);
  for (const sql of recreateSqls) {
    await tx.execute(sql);
  }
}

/**
 * 下界清洗的「挪位」方案：把 `${col} < lowerBound` 的脏行按 groupKey 分组，
 * 重新分配从「该组内合法最大值 + 1」起递增的新值，避免 SET col = lowerBound 撞同组
 * 已存在的合法行 PK/UNIQUE（chat_message 的 UNIQUE(session_id, seq)、
 * vfs_revision 的 PRIMARY KEY(entry_id, version)）。
 *
 * 清洗时表还是旧形态（rowid 表），用 rowid 定位行、按 rowid 排序保证幂等确定。
 * 没有合法行的组从 lowerBound 开始分配。@returns 被挪位的行数。
 */
async function renumberLowerBound(
  tx: TdbcConnection,
  table: string,
  col: string,
  groupKey: string,
  lowerBound: number,
): Promise<number> {
  const dirty = await tx.query<{ g: string | number }>(
    `SELECT ${groupKey} AS g FROM ${table}
     WHERE ${col} < ${lowerBound}
     GROUP BY ${groupKey}`,
  );
  if (dirty.length === 0) {
    return 0;
  }
  let fixed = 0;
  for (const d of dirty) {
    const g = d.g;
    const maxRows = await tx.query<{ m: number | null }>(
      `SELECT MAX(${col}) AS m FROM ${table}
       WHERE ${groupKey} = ? AND ${col} >= ${lowerBound}`,
      [g],
    );
    let next = Number(maxRows[0]?.m ?? lowerBound - 1);
    const rows = await tx.query<{ rid: number }>(
      `SELECT rowid AS rid FROM ${table}
       WHERE ${groupKey} = ? AND ${col} < ${lowerBound}
       ORDER BY rowid`,
      [g],
    );
    for (const r of rows) {
      next += 1;
      await tx.execute(
        `UPDATE ${table} SET ${col} = ? WHERE rowid = ?`,
        [next, Number(r.rid)],
      );
      fixed++;
    }
  }
  if (fixed > 0) {
    console.warn(
      `[table-constraints-v1] ${table}.${col}: 挪位 ${fixed} 条下界脏行（< ${lowerBound} → 递增分配，避免 PK 冲突）`,
    );
  }
  return fixed;
}

/** Step 11：脏值预扫描 + 清洗。每个要加 CHECK/NOT NULL/UNIQUE 的列先扫后清。 */
async function scanAndCleanDirtyValues(tx: TdbcConnection): Promise<void> {
  // —— 声明了 FK 的表先清孤儿引用行，rebuild INSERT 时 FK 才不会炸 ——
  await discard(tx, "llm_saved_model", "provider_id NOT IN (SELECT id FROM llm_provider)");
  await discard(tx, "regex_rule", "group_id NOT IN (SELECT group_id FROM regex_group)");

  // —— TEXT PK 列 NULL 行：NOT NULL 约束加上后无法保留，统一丢弃 ——
  await discard(tx, "chat_project", "id IS NULL");
  await discard(tx, "chat_session", "id IS NULL");
  await discard(tx, "chat_message", "id IS NULL");
  await discard(tx, "llm_provider", "id IS NULL");
  await discard(tx, "llm_saved_model", "id IS NULL");
  await discard(tx, "regex_group", "group_id IS NULL");
  await discard(tx, "regex_rule", "group_id IS NULL OR rule_id IS NULL");
  await discard(tx, "agent_definition", "agent_id IS NULL");
  await discard(tx, "sksp_secrets", "ref IS NULL");
  await discard(tx, "vfs_content_blob", "content_hash IS NULL");
  await discard(tx, "message_checkpoint", "session_id IS NULL OR message_id IS NULL");
  await discard(
    tx,
    "message_checkpoint_file",
    "session_id IS NULL OR message_id IS NULL OR entry_id IS NULL",
  );
  await discard(
    tx,
    "workplace_dir_rule",
    "scope_key IS NULL OR logical_path IS NULL",
  );
  await discard(
    tx,
    "workplace_file_rule",
    "scope_key IS NULL OR logical_path IS NULL",
  );

  // —— 枚举值域 CHECK 清洗 ——
  await clean(tx, "chat_message", "role = 'user'", "role NOT IN ('user', 'assistant', 'system', 'tool')");
  await clean(tx, "chat_message", "hidden = 0", "hidden NOT IN (0, 1)");
  await clean(tx, "vfs_entry", "entry_kind = 'file'", "entry_kind NOT IN ('file', 'directory')");
  await clean(tx, "vfs_revision", "status = 'deleted'", "status NOT IN ('active', 'deleted')");
  await clean(tx, "vfs_content_blob", "encoding = 'zlib'", "encoding NOT IN ('zlib', 'zlib-b64')");
  await clean(
    tx,
    "workplace_dir_rule",
    "sort_field = 'name'",
    "sort_field NOT IN ('name', 'created', 'updated')",
  );
  await clean(tx, "workplace_dir_rule", "sort_order = 'asc'", "sort_order NOT IN ('asc', 'desc')");
  await clean(
    tx,
    "workplace_dir_rule",
    "fill_policy = 'header'",
    "fill_policy NOT IN ('hidden', 'filename', 'header', 'full')",
  );
  await clean(tx, "workplace_dir_rule", "rule_enabled = 0", "rule_enabled NOT IN (0, 1)");
  await clean(
    tx,
    "workplace_file_rule",
    "inclusion_mode = 'auto'",
    "inclusion_mode NOT IN ('auto', 'show', 'hide')",
  );

  // —— regex_rule flags：清掉含非法字符（非 g/i/m/s/u/y）的 flags ——
  await clean(tx, "regex_rule", "flags = ''", "flags GLOB '*[^gimsuy]*'");
  await clean(tx, "regex_rule", "enabled = 0", "enabled NOT IN (0, 1)");
  await clean(tx, "regex_rule", "scope_user = 0", "scope_user NOT IN (0, 1)");
  await clean(tx, "regex_rule", "scope_assistant = 0", "scope_assistant NOT IN (0, 1)");
  await dedupRegexSortOrder(tx);

  // —— boolean / 枚举：provider / agent / sksp ——
  await clean(tx, "llm_provider", "is_builtin = 0", "is_builtin NOT IN (0, 1)");
  // settings_json / prompts_json 是 NOT NULL，非法 JSON 统一清洗成 '{}'（空对象）。
  await clean(
    tx,
    "llm_saved_model",
    "settings_json = '{}'",
    "json_valid(settings_json) = 0",
  );
  await clean(
    tx,
    "agent_definition",
    "prompts_json = '{}'",
    "json_valid(prompts_json) = 0",
  );

  // —— sksp_secrets：先清非法 algo（统一改 dpapi-v1，因为它不要求 iv，安全兜底），
  //    再处理「非 dpapi 但 iv NULL」的耦合脏值（同样改 algo=dpapi-v1 让约束通过）。——
  await clean(
    tx,
    "sksp_secrets",
    "algo = 'dpapi-v1'",
    "algo NOT IN ('linux-secret-service-aes-gcm-v1', 'macos-keychain-aes-gcm-v1', 'android-keystore-aes-gcm-v1', 'dpapi-v1')",
  );
  await clean(
    tx,
    "sksp_secrets",
    "algo = 'dpapi-v1'",
    "algo != 'dpapi-v1' AND iv IS NULL",
  );

  // —— vfs_revision status-content_hash 耦合：active 但 content_hash NULL 改 deleted ——
  await clean(
    tx,
    "vfs_revision",
    "status = 'deleted'",
    "status = 'active' AND content_hash IS NULL",
  );

  // —— 下界 CHECK 清洗（负值 / 小于下界）——
  // seq / version 不能简单 SET = 1：同 session/entry 可能已有合法的 seq=1 / version=1 行，
  // 直接改写会撞 UNIQUE(session_id, seq) / PRIMARY KEY(entry_id, version) 导致 migration 卡死。
  // 改走「挪位」：把脏行按组重新分配到该组内合法最大值 +1 起递增的新值，保证不冲突。
  await renumberLowerBound(tx, "chat_message", "seq", "session_id", 1);
  await renumberLowerBound(tx, "vfs_revision", "version", "entry_id", 1);
  await clean(tx, "vfs_revision", "ref_count = 0", "ref_count < 0");
  await clean(tx, "vfs_content_blob", "ref_count = 0", "ref_count < 0");
  await clean(tx, "message_checkpoint_file", "revision_version = 1", "revision_version < 1");
  await clean(tx, "workplace_dir_rule", "head_count = 0", "head_count < 0");
  await clean(tx, "workplace_dir_rule", "tail_count = 0", "tail_count < 0");
}

/** Step 12：按表逐个 rebuild（列顺序与 canonical DDL 一致，靠 INSERT SELECT * 搬运）。 */
async function rebuildAllTables(tx: TdbcConnection): Promise<void> {
  // —— 先 DROP 所有触发器，避免 rebuild 表时悬空引用触发重编译失败。 ——
  // SQLite 的 ALTER TABLE RENAME 会自动重编译引用该表的触发器；如果被引用表正处于
  // DROP→RENAME 中间态，重编译会报 no such table。vfs_revision 的 3 个触发器引用
  // vfs_content_blob，rebuild blob 表时就会撞上。先全部 DROP，rebuild vfs_revision
  // 时在 recreateSqls 里统一重建。
  await tx.execute(`DROP TRIGGER IF EXISTS trg_revision_insert_inc_blob_ref`);
  await tx.execute(`DROP TRIGGER IF EXISTS trg_revision_delete_dec_blob_ref`);
  await tx.execute(`DROP TRIGGER IF EXISTS trg_revision_update_transfer_blob_ref`);

  // —— FK 预处理阶段：先把带 FK 的子表 rebuild 成无 FK 形态。 ——
  // 原因：foreign_keys=ON 时 DROP 父表会触发 ON DELETE CASCADE 连带删子表数据
  //（已实测确认）。所以 rebuild 父表前必须先摘除子表的 FK。子表此时先 rebuild 成
  // 无 FK 形态，后续正常阶段会再 rebuild 成带 FK 的最终形态（带约束）。
  await rebuildTable(
    tx,
    "llm_saved_model",
    `(
      id TEXT NOT NULL PRIMARY KEY,
      provider_id TEXT NOT NULL,
      vendor_model_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      settings_json TEXT NOT NULL CHECK (settings_json IS NULL OR json_valid(settings_json)),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
  );
  await rebuildTable(
    tx,
    "regex_rule",
    `(
      group_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      pattern TEXT NOT NULL,
      flags TEXT NOT NULL DEFAULT '' CHECK (flags NOT GLOB '*[^gimsuy]*'),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      llm_replace TEXT,
      display_replace TEXT,
      start_depth INTEGER,
      end_depth INTEGER,
      scope_user INTEGER NOT NULL DEFAULT 0 CHECK (scope_user IN (0, 1)),
      scope_assistant INTEGER NOT NULL DEFAULT 0 CHECK (scope_assistant IN (0, 1)),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (group_id, rule_id),
      UNIQUE (group_id, sort_order)
    )`,
  );

  // —— FK 被引用表先于引用表 rebuild（rename 后表名恢复，FK 解析正常）——

  await rebuildTable(
    tx,
    "llm_provider",
    `(
      id TEXT NOT NULL PRIMARY KEY,
      builtin_key TEXT UNIQUE,
      protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic', 'gemini')),
      base_url TEXT NOT NULL,
      display_name TEXT NOT NULL,
      secret_ref TEXT,
      headers_json TEXT NOT NULL DEFAULT '{}',
      is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
  );

  await rebuildTable(
    tx,
    "llm_saved_model",
    `(
      id TEXT NOT NULL PRIMARY KEY,
      provider_id TEXT NOT NULL,
      vendor_model_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      settings_json TEXT NOT NULL CHECK (settings_json IS NULL OR json_valid(settings_json)),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
    )`,
    [`CREATE INDEX IF NOT EXISTS idx_llm_saved_model_provider ON llm_saved_model(provider_id)`],
  );

  await rebuildTable(tx, "chat_project", `(
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    agent_config_json TEXT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);

  await rebuildTable(
    tx,
    "chat_session",
    `(
      id TEXT NOT NULL PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT,
      composer_draft_json TEXT NULL,
      agent_config_json TEXT NULL,
      parent_session_id TEXT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
    [
      `CREATE INDEX IF NOT EXISTS idx_chat_session_project ON chat_session(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_chat_session_parent ON chat_session(parent_session_id)`,
    ],
  );

  await rebuildTable(
    tx,
    "chat_message",
    `(
      id TEXT NOT NULL PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL CHECK (seq >= 1),
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
      content_json TEXT NOT NULL,
      provider TEXT,
      raw_json TEXT,
      created_at_ms INTEGER NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
      attachments_json TEXT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      UNIQUE (session_id, seq)
    )`,
  );

  await rebuildTable(
    tx,
    "message_checkpoint",
    `(
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (session_id, message_id)
    ) WITHOUT ROWID`,
  );

  await rebuildTable(
    tx,
    "message_checkpoint_file",
    `(
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      entry_id INTEGER NOT NULL,
      revision_version INTEGER NOT NULL CHECK (revision_version >= 1),
      PRIMARY KEY (session_id, message_id, entry_id)
    ) WITHOUT ROWID`,
  );

  // vfs_content_blob 必须先于 vfs_revision rebuild：vfs_revision 的 3 个触发器引用
  // vfs_content_blob，先把 blob 表建成新形态，再 rebuild revision 并重建触发器，
  // 触发器解析到的 vfs_content_blob 就是稳定的最终态，不会被后续 DROP/RENAME 搞坏。
  await rebuildTable(
    tx,
    "vfs_content_blob",
    `(
      content_hash TEXT NOT NULL PRIMARY KEY,
      encoding TEXT NOT NULL CHECK (encoding IN ('zlib', 'zlib-b64')),
      bytes BLOB NOT NULL,
      byte_len INTEGER NOT NULL,
      ref_count INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0)
    ) WITHOUT ROWID`,
  );

  await rebuildTable(
    tx,
    "vfs_entry",
    `(
      entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT NULL,
      head_version INTEGER NOT NULL DEFAULT 1,
      mtime_ms INTEGER NOT NULL,
      entry_kind TEXT NOT NULL DEFAULT 'file' CHECK (entry_kind IN ('file', 'directory')),
      content TEXT NULL,
      UNIQUE(scope_key, path)
    )`,
    // 发现 24：不再重建 idx_vfs_entry_scope_path（UNIQUE(scope_key, path) 隐式索引已覆盖）。
    [],
  );

  await rebuildTable(
    tx,
    "vfs_revision",
    `(
      entry_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
      mtime_ms INTEGER NOT NULL,
      content_hash TEXT NULL,
      ref_count INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
      PRIMARY KEY (entry_id, version),
      CHECK (NOT (status = 'active' AND content_hash IS NULL))
    ) WITHOUT ROWID`,
    [
      VFS_REVISION_INSERT_TRIGGER_DDL,
      VFS_REVISION_DELETE_TRIGGER_DDL,
      VFS_REVISION_UPDATE_TRIGGER_DDL,
    ],
  );

  await rebuildTable(tx, "regex_group", `(
    group_id TEXT NOT NULL PRIMARY KEY,
    display_name TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);

  await rebuildTable(
    tx,
    "regex_rule",
    `(
      group_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      pattern TEXT NOT NULL,
      flags TEXT NOT NULL DEFAULT '' CHECK (flags NOT GLOB '*[^gimsuy]*'),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      llm_replace TEXT,
      display_replace TEXT,
      start_depth INTEGER,
      end_depth INTEGER,
      scope_user INTEGER NOT NULL DEFAULT 0 CHECK (scope_user IN (0, 1)),
      scope_assistant INTEGER NOT NULL DEFAULT 0 CHECK (scope_assistant IN (0, 1)),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (group_id, rule_id),
      UNIQUE (group_id, sort_order),
      FOREIGN KEY (group_id) REFERENCES regex_group(group_id) ON DELETE CASCADE
    )`,
    [`CREATE INDEX IF NOT EXISTS idx_regex_rule_group_sort ON regex_rule (group_id, sort_order)`],
  );

  await rebuildTable(
    tx,
    "workplace_dir_rule",
    `(
      scope_key TEXT NOT NULL,
      logical_path TEXT NOT NULL,
      rule_enabled INTEGER NOT NULL DEFAULT 1 CHECK (rule_enabled IN (0, 1)),
      sort_field TEXT NOT NULL DEFAULT 'name' CHECK (sort_field IN ('name', 'created', 'updated')),
      sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
      head_count INTEGER NOT NULL DEFAULT 0 CHECK (head_count >= 0),
      tail_count INTEGER NOT NULL DEFAULT 1000 CHECK (tail_count >= 0),
      fill_policy TEXT NOT NULL DEFAULT 'header' CHECK (fill_policy IN ('hidden', 'filename', 'header', 'full')),
      PRIMARY KEY (scope_key, logical_path)
    )`,
    [`CREATE INDEX IF NOT EXISTS idx_workplace_dir_scope ON workplace_dir_rule(scope_key)`],
  );

  await rebuildTable(
    tx,
    "workplace_file_rule",
    `(
      scope_key TEXT NOT NULL,
      logical_path TEXT NOT NULL,
      inclusion_mode TEXT NOT NULL DEFAULT 'auto' CHECK (inclusion_mode IN ('auto', 'show', 'hide')),
      PRIMARY KEY (scope_key, logical_path)
    )`,
    [`CREATE INDEX IF NOT EXISTS idx_workplace_file_scope ON workplace_file_rule(scope_key)`],
  );

  await rebuildTable(
    tx,
    "agent_definition",
    `(
      agent_id TEXT NOT NULL PRIMARY KEY,
      prompts_json TEXT NOT NULL CHECK (prompts_json IS NULL OR json_valid(prompts_json)),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
  );

  await rebuildTable(
    tx,
    "sksp_secrets",
    `(
      ref TEXT NOT NULL PRIMARY KEY,
      ciphertext BLOB NOT NULL,
      iv BLOB,
      algo TEXT NOT NULL CHECK (algo IN (
        'linux-secret-service-aes-gcm-v1',
        'macos-keychain-aes-gcm-v1',
        'android-keystore-aes-gcm-v1',
        'dpapi-v1'
      )),
      version INTEGER NOT NULL DEFAULT 1,
      updated_at_ms INTEGER NOT NULL,
      CHECK ((algo = 'dpapi-v1') OR (iv IS NOT NULL))
    )`,
  );
}

async function up(tx: TdbcConnection): Promise<void> {
  // 发现 24：DROP 冗余索引 idx_vfs_entry_scope_path。必须放在 isAlreadyConstrained 早退
  // 之前——新库路径（canonical DDL 已是带约束形态，早退 return）也会被
  // vfs-entry-id-redesign-v1 的 rebuildIndexes 建出这个冗余索引（UNIQUE(scope_key, path)
  // 隐式索引已覆盖它的全部用途），不在这里 DROP 就会永久残留。
  await tx.execute(`DROP INDEX IF EXISTS idx_vfs_entry_scope_path`);
  // 同批清理两个 PK 左前缀冗余索引（vfs_revision / message_checkpoint 的复合
  // PK B-tree 完全覆盖它们）；且部分真机 quick-sqlite 对 WITHOUT ROWID 表建
  // 索引报 disk I/O error，不能再建。
  await tx.execute(`DROP INDEX IF EXISTS idx_vfs_revision_entry`);
  await tx.execute(`DROP INDEX IF EXISTS idx_message_checkpoint_session`);

  const constrained = await isAlreadyConstrained(tx);
  if (constrained) {
    return;
  }

  await scanAndCleanDirtyValues(tx);
  await rebuildAllTables(tx);

  // vfs_entry rebuild（DROP TABLE）时该索引已随表一起删掉，上面那条 DROP IF EXISTS 已兜底，
  // 无需重复执行。
}

/** 表设计约束补全 rebuild migration（NOT NULL / CHECK / WITHOUT ROWID / UNIQUE / json_valid）。 */
export const tableConstraintsV1Migration: SchemaMigration = {
  id: TABLE_CONSTRAINTS_V1_ID,
  up,
};

export { up as tableConstraintsV1Up };
