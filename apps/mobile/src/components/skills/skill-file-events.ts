/**
 * 技能文件浏览器与编辑器之间的事件约定。
 *
 * SkillFileManager 删除辅助文件后广播，FileEditor 的 skill scope 监听：
 * 正被打开的文件命中时踢回，避免停留在已不存在的文件上。
 * 独立成模块是为了让 FileEditorScreen 不必引入整个浏览器组件链。
 */
import {DeviceEventEmitter} from 'react-native';
import type {SkillDomain} from '@novel-master/core/skills';

/** 被删技能文件广播事件名。 */
export const SKILL_FILE_DELETED_EVENT = 'skill-file-deleted';

export type SkillFileDeletedPayload = {
  domain: SkillDomain;
  name: string;
  projectId?: string;
  relPath: string;
};

/** 广播被删技能文件（域 + 名称 + 项目上下文 + 相对路径）。 */
export function emitSkillFileDeleted(payload: SkillFileDeletedPayload): void {
  DeviceEventEmitter.emit(SKILL_FILE_DELETED_EVENT, payload);
}
