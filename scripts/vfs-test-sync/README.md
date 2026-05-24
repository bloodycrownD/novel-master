# vfs-test-sync

Dev-only script to force-sync between the Novel Master VFS (SQLite) and a local mirror directory.

## Commands

| Command | Authority | Behavior |
|---------|-----------|----------|
| `push` | VFS | Write all paths under `--prefix` to `--mirror`; delete disk orphans |
| `pull` | Disk | Write mirror files to VFS; delete VFS orphans (`versionCheck: false` on updates) |
| `watch` | Trigger side | Disk change → `pull`; VFS poll change → `push` (debounced) |

## Setup

From the repo root (requires **Node 22** — see `.nvmrc`; matches Cursor bundled Node):

```bash
nvm use          # reads .nvmrc → 22.22.0
npm install
npm run build -w @novel-master/core
npm run build -w @novel-master/vfs-test-sync
npm rebuild better-sqlite3
```

**Windows / nvm:** run `nvm use` in the **same terminal** before `npm run`. If `vfs:sync` still reports Node 24, check `where node` and `where npm` — both must point to `v22.22.0`. Close the terminal and open a new one after `nvm use`.

If you see `NODE_MODULE_VERSION` / `ERR_DLOPEN_FAILED`:

```bash
nvm use 22.22.0
npm rebuild better-sqlite3
```

## Usage

```bash
# 默认镜像目录 ./tmp/mirror（仓库根）
npm run vfs:watch
npm run vfs:push
npm run vfs:pull

# 自定义参数仍用 vfs:sync
npm run vfs:sync -- watch --mirror ./other-mirror --verbose
npm run vfs:sync -- push --mirror ./tmp/vfs-mirror
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
