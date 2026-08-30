/**
 * tests/G-5：vfs-operations.service 真实单测。
 *
 * 只 mock 底层（内存 FakeVfs 代替 runtime.sessionVfs / vfs，
 * userVfsTurn.executeOp 记录 op），被测 service 与 core 的 moveVfsPath /
 * buildUserVfs*Op 编排逻辑全部真实执行。
 */
import {VfsError} from '@novel-master/core';
import type {UserVfsTurnOp} from '@novel-master/core/chat';
import type {VfsListEntry, VfsScope, VfsService} from '@novel-master/core/vfs';
import {
  createVfsDirectory,
  deleteScopedVfsEntry,
  renameVfsDirectory,
  renameVfsFile,
  sessionCreateVfsDirectory,
  sessionCreateVfsFile,
  sessionRenameVfsFile,
  sessionSaveVfsFile,
} from '@/services/vfs-operations.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

type FakeEntry = {path: string; kind: 'file' | 'directory'};

function notFound(path: string): VfsError {
  return new VfsError('NOT_FOUND', `Path not found: ${path}`, {path});
}

class FakeVfs {
  files = new Map<string, string>();
  dirs = new Set<string>();
  mkdirCalls: string[] = [];
  /** 注入 delete 失败的路径（模拟批量删除中某项失联）。 */
  failDelete = new Set<string>();

  async read(path: string) {
    const content = this.files.get(path);
    if (content !== undefined) {
      return {path, content, version: 1, mtimeMs: 0};
    }
    if (this.dirs.has(path)) {
      throw new VfsError('IS_DIRECTORY', `Path is a directory: ${path}`, {
        path,
      });
    }
    throw notFound(path);
  }

  async list(dir: string, options?: {recursive?: boolean}) {
    const normalized =
      dir !== '/' && dir.endsWith('/') ? dir.slice(0, -1) : dir;
    const prefix = normalized === '/' ? '/' : `${normalized}/`;
    const out: FakeEntry[] = [];
    if (this.dirs.has(normalized)) {
      out.push({path: normalized, kind: 'directory'});
    }
    const collect = (path: string, kind: 'file' | 'directory') => {
      if (path === normalized || !path.startsWith(prefix)) {
        return;
      }
      const rest = path.slice(prefix.length);
      if (!options?.recursive && rest.includes('/')) {
        return;
      }
      out.push({path, kind});
    };
    for (const d of this.dirs) {
      collect(d, 'directory');
    }
    for (const f of this.files.keys()) {
      collect(f, 'file');
    }
    return out as VfsListEntry[];
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirCalls.push(path);
    this.dirs.add(path);
  }

  async write(path: string, content: string): Promise<{version: number}> {
    this.files.set(path, content);
    return {version: 1};
  }

  async delete(path: string): Promise<void> {
    if (this.failDelete.has(path)) {
      throw notFound(path);
    }
    const normalized =
      path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
    this.files.delete(normalized);
    this.dirs.delete(normalized);
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${normalized}/`)) {
        this.files.delete(key);
      }
    }
    for (const dir of [...this.dirs]) {
      if (dir.startsWith(`${normalized}/`)) {
        this.dirs.delete(dir);
      }
    }
  }

  async renamePath(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (content === undefined) {
      throw notFound(from);
    }
    const normalizedTo = to !== '/' && to.endsWith('/') ? to.slice(0, -1) : to;
    this.files.delete(from);
    this.files.set(normalizedTo, content);
  }

  async renamePrefix(oldDir: string, newDir: string): Promise<void> {
    if (!this.dirs.has(oldDir)) {
      throw notFound(oldDir);
    }
    const remap = (path: string): string =>
      path === oldDir
        ? newDir
        : path.startsWith(`${oldDir}/`)
        ? `${newDir}${path.slice(oldDir.length)}`
        : path;
    for (const dir of [...this.dirs]) {
      this.dirs.delete(dir);
      this.dirs.add(remap(dir));
    }
    for (const [key, value] of [...this.files.entries()]) {
      this.files.delete(key);
      this.files.set(remap(key), value);
    }
  }
}

function makeRuntime() {
  const executedOps: {sessionId: string; op: UserVfsTurnOp}[] = [];
  const deleteRulesCalls: {scope: VfsScope; path: string}[] = [];
  const runtime = {
    userVfsTurn: {
      executeOp: async (sessionId: string, op: UserVfsTurnOp) => {
        executedOps.push({sessionId, op});
        return {ok: true as const};
      },
    },
    workplace: (scope: VfsScope) => ({
      deleteRulesUnderLogicalPrefix: async (path: string) => {
        deleteRulesCalls.push({scope, path});
      },
    }),
  } as unknown as MobileNovelMasterRuntime;
  return {runtime, executedOps, deleteRulesCalls};
}

function seededVfs(): FakeVfs {
  const vfs = new FakeVfs();
  vfs.files.set('/a.md', 'content-a');
  vfs.files.set('/b.md', 'content-b');
  vfs.dirs.add('/old');
  vfs.dirs.add('/old/sub');
  vfs.files.set('/old/sub/note.md', 'note');
  vfs.dirs.add('/target');
  vfs.files.set('/target/keep.md', 'keep');
  return vfs;
}

describe('vfs-operations move/rename 冲突', () => {
  it('renameVfsFile 目标文件已存在 → ALREADY_EXISTS 且双端内容不变', async () => {
    const vfs = seededVfs();
    await expect(
      renameVfsFile(vfs as unknown as VfsService, '/a.md', '/b.md'),
    ).rejects.toMatchObject({name: 'VfsError', code: 'ALREADY_EXISTS'});
    expect(vfs.files.get('/a.md')).toBe('content-a');
    expect(vfs.files.get('/b.md')).toBe('content-b');
  });

  it('renameVfsDirectory 目标目录已存在（非空）→ ALREADY_EXISTS 且子树未动', async () => {
    const vfs = seededVfs();
    await expect(
      renameVfsDirectory(vfs as unknown as VfsService, '/old', '/target'),
    ).rejects.toMatchObject({name: 'VfsError', code: 'ALREADY_EXISTS'});
    expect(vfs.files.get('/old/sub/note.md')).toBe('note');
    expect(vfs.files.get('/target/keep.md')).toBe('keep');
    expect(vfs.files.has('/target/sub/note.md')).toBe(false);
  });

  it('rename 源不存在 → NOT_FOUND', async () => {
    const vfs = seededVfs();
    await expect(
      renameVfsFile(vfs as unknown as VfsService, '/missing.md', '/c.md'),
    ).rejects.toMatchObject({name: 'VfsError', code: 'NOT_FOUND'});
  });
});

describe('vfs-operations move/rename 成功路径与路径边界', () => {
  it('文件改名：旧路径 NOT_FOUND、新路径内容保留', async () => {
    const vfs = seededVfs();
    await renameVfsFile(vfs as unknown as VfsService, '/a.md', '/renamed.md');
    expect(vfs.files.has('/a.md')).toBe(false);
    expect(vfs.files.get('/renamed.md')).toBe('content-a');
  });

  it('目录改名：子树路径整体 remap', async () => {
    const vfs = seededVfs();
    await renameVfsDirectory(vfs as unknown as VfsService, '/old', '/fresh');
    expect(vfs.files.has('/old/sub/note.md')).toBe(false);
    expect(vfs.files.get('/fresh/sub/note.md')).toBe('note');
    expect(vfs.dirs.has('/fresh/sub')).toBe(true);
  });

  it('目标路径带尾斜杠可归一化成功', async () => {
    const vfs = seededVfs();
    await renameVfsFile(vfs as unknown as VfsService, '/a.md', '/moved.md/');
    expect(vfs.files.get('/moved.md')).toBe('content-a');
  });

  it('createVfsDirectory 去掉尾斜杠后再 mkdir', async () => {
    const vfs = new FakeVfs();
    await createVfsDirectory(vfs as unknown as VfsService, 'dir/');
    expect(vfs.mkdirCalls).toEqual(['dir']);
  });
});

describe('vfs-operations 批量删除部分失败', () => {
  it('第二项删除失败：首项已生效、错误上抛、剩余项未动', async () => {
    const vfs = seededVfs();
    vfs.files.set('/x.md', 'x');
    vfs.files.set('/y.md', 'y');
    vfs.failDelete.add('/y.md');
    const {runtime, deleteRulesCalls} = makeRuntime();
    const scope = {
      kind: 'session',
      projectId: 'p1',
      sessionId: 's1',
    } as VfsScope;

    const batch = ['/x.md', '/y.md', '/a.md'];
    let failure: unknown;
    try {
      for (const path of batch) {
        // 模拟文件管理器批量删除循环（fail-fast，错误中断批次）
        // eslint-disable-next-line no-await-in-loop
        await deleteScopedVfsEntry(
          runtime,
          scope,
          vfs as unknown as VfsService,
          path,
          {
            useUserVfsTurn: false,
          },
        );
      }
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({name: 'VfsError', code: 'NOT_FOUND'});
    expect(vfs.files.has('/x.md')).toBe(false);
    expect(vfs.files.get('/a.md')).toBe('content-a');
    expect(vfs.files.get('/y.md')).toBe('y');
  });

  it('VFS 删除失败时不清理 worktree 规则；成功项才清理', async () => {
    const vfs = seededVfs();
    vfs.failDelete.add('/a.md');
    const {runtime, deleteRulesCalls} = makeRuntime();
    const scope = {
      kind: 'session',
      projectId: 'p1',
      sessionId: 's1',
    } as VfsScope;

    await expect(
      deleteScopedVfsEntry(
        runtime,
        scope,
        vfs as unknown as VfsService,
        '/a.md',
        {
          useUserVfsTurn: false,
        },
      ),
    ).rejects.toMatchObject({code: 'NOT_FOUND'});
    expect(deleteRulesCalls).toEqual([]);

    await deleteScopedVfsEntry(
      runtime,
      scope,
      vfs as unknown as VfsService,
      '/b.md',
      {
        useUserVfsTurn: false,
      },
    );
    expect(deleteRulesCalls).toEqual([{scope, path: '/b.md'}]);
  });

  it('useUserVfsTurn 时经 executeOp 发 rm 操作，成功后仍清 worktree', async () => {
    const vfs = seededVfs();
    const {runtime, executedOps, deleteRulesCalls} = makeRuntime();
    const scope = {
      kind: 'session',
      projectId: 'p1',
      sessionId: 's1',
    } as VfsScope;

    await deleteScopedVfsEntry(
      runtime,
      scope,
      vfs as unknown as VfsService,
      '/old',
      {
        useUserVfsTurn: true,
        sessionId: 's1',
        recursive: false,
      },
    );

    expect(executedOps).toHaveLength(1);
    expect(executedOps[0]!.sessionId).toBe('s1');
    expect(executedOps[0]!.op.tools).toEqual([
      {
        id: expect.any(String),
        name: 'fs',
        input: {action: 'rm', path: '/old', recursive: false},
      },
    ]);
    expect(deleteRulesCalls).toEqual([{scope, path: '/old'}]);
  });
});

describe('vfs-operations 会话 scope 编排（mock userVfsTurn 端口）', () => {
  it('sessionCreateVfsFile 发 write（new-file）op 且透传 content', async () => {
    const vfs = new FakeVfs();
    const {runtime, executedOps} = makeRuntime();
    await sessionCreateVfsFile(runtime, 's1', '/new.md', 'hello');
    expect(executedOps).toHaveLength(1);
    expect(executedOps[0]!.op.tools[0]).toMatchObject({
      name: 'write',
      input: {path: '/new.md', content: 'hello'},
    });
  });

  it('sessionCreateVfsDirectory 去尾斜杠后发 mkdir op', async () => {
    const {runtime, executedOps} = makeRuntime();
    await sessionCreateVfsDirectory(runtime, 's1', 'dir/');
    expect(executedOps[0]!.op.tools[0]).toMatchObject({
      name: 'fs',
      input: {action: 'mkdir', path: 'dir'},
    });
  });

  it('sessionRenameVfsFile 发 mv op（from/to 透传）', async () => {
    const {runtime, executedOps} = makeRuntime();
    await sessionRenameVfsFile(runtime, 's1', '/a.md', '/b/c.md');
    expect(executedOps[0]!.op.tools[0]).toMatchObject({
      name: 'fs',
      input: {action: 'mv', from: '/a.md', to: '/b/c.md'},
    });
  });

  it('sessionSaveVfsFile 内容无变化时 no-op（不执行 op）；有变化时执行', async () => {
    const vfs = seededVfs();
    const {runtime, executedOps} = makeRuntime();

    await sessionSaveVfsFile(
      runtime,
      's1',
      vfs as unknown as VfsService,
      '/a.md',
      'content-a',
    );
    expect(executedOps).toHaveLength(0);

    await sessionSaveVfsFile(
      runtime,
      's1',
      vfs as unknown as VfsService,
      '/a.md',
      'content-a2',
    );
    expect(executedOps).toHaveLength(1);
    expect(executedOps[0]!.op.tools.length).toBeGreaterThan(0);
  });
});
