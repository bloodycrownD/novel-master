"""e2e 探针：清理后核对库里孤儿 blob 是否回收、引用对是否幸存。"""
import hashlib
import json
import sqlite3
import sys

db = sys.argv[1]
conn = sqlite3.connect(db)
orphan_hash = hashlib.sha256("orphan-0".encode()).hexdigest()
keep_body = "被引用的正常缓存正文，不应被清理回收。".encode("utf-8") * 4000
keep_hash = hashlib.sha256(keep_body).hexdigest()
orphan_left = conn.execute(
    "SELECT COUNT(*) FROM session_file_cache_blob WHERE content_hash LIKE '%' || ? || '%' OR content_hash IN (?,?,?)",
    ("", hashlib.sha256("orphan-0".encode()).hexdigest(), hashlib.sha256("orphan-1".encode()).hexdigest(), hashlib.sha256("orphan-2".encode()).hexdigest()),
).fetchone()[0]
# 直接按已知 hash 计数（上面 LIKE 写法冗余，稳妥起见重查）
orphans = [hashlib.sha256(f"orphan-{i}".encode()).hexdigest() for i in range(3)]
orphan_left = conn.execute(
    f"SELECT COUNT(*) FROM session_file_cache_blob WHERE content_hash IN ({','.join('?' * len(orphans))})",
    orphans,
).fetchone()[0]
kept = conn.execute(
    "SELECT COUNT(*) FROM session_file_cache_blob WHERE content_hash = ?", (keep_hash,)
).fetchone()[0]
conn.close()
print(json.dumps({"orphanBlobs": orphan_left, "keptBlobs": kept}))
