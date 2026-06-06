/**
 * Native VFS ZIP builder: write gather payload to temp dir, zip on native thread.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import {zip} from 'react-native-zip-archive';
import type {VfsZipBuildFn} from '@novel-master/core';

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function exportWorkId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureDir(dirPath: string): Promise<void> {
  const exists = await ReactNativeBlobUtil.fs.exists(dirPath);
  if (!exists) {
    await ReactNativeBlobUtil.fs.mkdir(dirPath);
  }
}

async function ensureParentDirs(filePath: string): Promise<void> {
  const slash = filePath.lastIndexOf('/');
  if (slash < 0) {
    return;
  }
  const parent = filePath.slice(0, slash);
  const parts = parent.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    await ensureDir(current);
  }
}

async function removeTree(rootPath: string): Promise<void> {
  const exists = await ReactNativeBlobUtil.fs.exists(rootPath);
  if (!exists) {
    return;
  }
  const stat = await ReactNativeBlobUtil.fs.stat(rootPath);
  if (stat.type !== 'directory') {
    await ReactNativeBlobUtil.fs.unlink(rootPath);
    return;
  }
  for (const name of await ReactNativeBlobUtil.fs.ls(rootPath)) {
    await removeTree(`${rootPath}/${name}`);
  }
  await ReactNativeBlobUtil.fs.unlink(rootPath);
}

/** Mobile buildZip hook: temp files → native zip (STORE) → Uint8Array. */
export const nativeBuildVfsZip: VfsZipBuildFn = async ({
  files,
  directoryEntryNames,
}) => {
  const cacheDir = ReactNativeBlobUtil.fs.dirs.CacheDir;
  const workId = exportWorkId();
  const workDir = `${cacheDir}/vfs-export-${workId}`;
  const zipPath = `${cacheDir}/vfs-export-${workId}.zip`;

  await ensureDir(workDir);

  try {
    for (const dirName of directoryEntryNames) {
      const normalized = dirName.endsWith('/') ? dirName.slice(0, -1) : dirName;
      if (normalized.length === 0) {
        continue;
      }
      await ensureParentDirs(`${workDir}/${normalized}`);
      await ensureDir(`${workDir}/${normalized}`);
    }

    for (const [entryName, content] of files) {
      const fullPath = `${workDir}/${entryName}`;
      await ensureParentDirs(fullPath);
      await ReactNativeBlobUtil.fs.writeFile(fullPath, content, 'utf8');
    }

    // level 0 (STORE): matches Core default buildVfsZip semantics.
    await zip(workDir, zipPath, 0);

    const base64 = await ReactNativeBlobUtil.fs.readFile(zipPath, 'base64');
    return base64ToBytes(base64);
  } finally {
    await removeTree(workDir).catch(() => undefined);
    await ReactNativeBlobUtil.fs.unlink(zipPath).catch(() => undefined);
  }
};
