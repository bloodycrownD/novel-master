/**
 * Mobile VFS ZIP export/import via Core service + RN file IO.
 */
import {Platform, Share} from 'react-native';
import {
  createVfsZipIoService,
  type VfsScope,
  type VfsZipImportOptions,
} from '@novel-master/core';
import {pick, types} from '@react-native-documents/picker';
import type {MobileNovelMasterRuntime} from '../runtime/types';

export async function exportVfsZip(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
): Promise<void> {
  const zipSvc = createVfsZipIoService(runtime.conn);
  const bytes = await zipSvc.export(scope);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = globalThis.btoa(binary);
  const uri = `data:application/zip;base64,${base64}`;
  await Share.share({
    title: 'VFS 导出',
    message: Platform.OS === 'ios' ? 'VFS ZIP 导出' : undefined,
    url: uri,
  });
}

export async function importVfsZip(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: Pick<VfsZipImportOptions, 'confirmed'>,
): Promise<void> {
  const [file] = await pick({
    type: [types.zip],
    allowMultiSelection: false,
  });
  if (file == null) {
    return;
  }
  const uri = file.uri;
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  const zipSvc = createVfsZipIoService(runtime.conn);
  await zipSvc.import(scope, new Uint8Array(buffer), {
    confirmed: options.confirmed,
  });
}
