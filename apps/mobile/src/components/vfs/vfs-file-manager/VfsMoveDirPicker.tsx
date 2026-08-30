/**
 * VfsFileManager 批量移动的目标目录选择弹窗（FileReferencePicker 的定向包装）。
 */
import React from 'react';
import {FileReferencePicker} from '@/components/chat/FileReferencePicker';
import type {VfsScope} from '@novel-master/core/vfs';

type Props = {
  visible: boolean;
  scope: VfsScope;
  /** 被移动的源路径集合：自身/祖先目录不可作为目标。 */
  blockedSourcePaths: string[];
  onClose: () => void;
  onConfirmDir: (targetDir: string) => void;
};

export function VfsMoveDirPicker({
  visible,
  scope,
  blockedSourcePaths,
  onClose,
  onConfirmDir,
}: Props) {
  return (
    <FileReferencePicker
      visible={visible}
      mode="pick-directory"
      scope={scope}
      blockedSourcePaths={blockedSourcePaths}
      onClose={onClose}
      onConfirmDir={onConfirmDir}
    />
  );
}
