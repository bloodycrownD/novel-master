"""e2e 造数据：往数据清理用例的隔离库塞缓存 blob。

- 孤儿 blob ×3（无 session_file_cache_entry 引用，随机字节 ~2MB/个，zlib 压不动）
  → 数据清理的 GC 应回收、VACUUM 后库文件实际缩小
- 正常引用对 ×1（entry+blob 成对）→ GC 不得误删（误删探针）
"""
import hashlib
import random
import sqlite3
import sys
import zlib

db = sys.argv[1]
random.seed(20260922)
conn = sqlite3.connect(db)

for i in range(3):
    raw = random.randbytes(2 * 1024 * 1024)
    h = hashlib.sha256(f"orphan-{i}".encode()).hexdigest()
    comp = zlib.compress(raw)
    conn.execute(
        "INSERT OR REPLACE INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len) VALUES (?, 'zlib', ?, ?)",
        (h, sqlite3.Binary(comp), len(comp)),
    )

keep_body = "被引用的正常缓存正文，不应被清理回收。".encode("utf-8") * 4000
keep_hash = hashlib.sha256(keep_body).hexdigest()
keep_comp = zlib.compress(keep_body)
conn.execute(
    "INSERT OR REPLACE INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len) VALUES (?, 'zlib', ?, ?)",
    (keep_hash, sqlite3.Binary(keep_comp), len(keep_comp)),
)
conn.execute(
    "INSERT OR REPLACE INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms) VALUES (?, ?, ?, ?)",
    ("e2e-maintenance-probe-session", "full:/探针.md", keep_hash, 1758900000000),
)
conn.commit()
conn.close()
print("seeded")
