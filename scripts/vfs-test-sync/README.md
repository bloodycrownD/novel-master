# vfs-test-sync

Dev-only script to force-sync between the Novel Master VFS (SQLite) and a local mirror directory.

## Commands

| Command | Authority | Behavior |
|---------|-----------|----------|
| `push` | VFS | Write all paths under `--prefix` to `--mirror`; delete disk orphans |
| `pull` | Disk | Write mirror files to VFS; delete VFS orphans (`versionCheck: false` on updates) |
| `watch` | Trigger side | Disk change → `pull`; VFS poll change → `push` (debounced) |

## Setup

From the repo root:

```bash
npm install
npm run build -w @novel-master/core
npm run build -w @novel-master/vfs-test-sync
```

## Usage

```bash
# Via workspace script
npm run vfs:sync -- push --mirror ./tmp/vfs-mirror

# Or directly
npm run start -w @novel-master/vfs-test-sync -- pull --mirror ./tmp/vfs-mirror --db ./.novel-master/novel.db

# Watch mode (Ctrl+C to stop)
npm run vfs:sync -- watch --mirror ./tmp/vfs-mirror --verbose
```

### Options

- `--db <path>` — SQLite DB (default `./.novel-master/novel.db`; env `NOVEL_MASTER_DB` wins)
- `--mirror <dir>` — mirror root (required, or env `VFS_TEST_MIRROR`)
- `--prefix <vfsPath>` — VFS prefix (default `/`)
- `--debounce-ms <n>` — watch debounce (default `300`)
- `--poll-ms <n>` — VFS poll interval (default `500`)
- `--verbose` — log each create/update/delete on stderr
- `--once` — single VFS poll cycle (tests)

### Path mapping

`mirror/foo/bar.md` ↔ VFS `/foo/bar.md` when `--prefix /`.

`.git` under the mirror is skipped and never synced.

## Tests

```bash
npm run test -w @novel-master/vfs-test-sync
```
