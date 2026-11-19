/**
 * 移动端更新检查平台壳：本地版本默认取 APP_VERSION，release notes 回落 mobile 文案。
 *
 * 拉取 / tag 解析 / 域名白名单 / 版本比较全部走 core 的 `UpdateCheck`（与 desktop
 * 同源）；本文件只保留平台默认值与 jest mock 缝。
 */

import {UpdateCheck, type FetchFn, type UpdateCheckData} from '@novel-master/core/common';
import {type AppError, Result} from '@novel-master/core/errors';
import {APP_VERSION} from './app-meta';

export namespace CheckForUpdates {
  export function check(localVersion: string = APP_VERSION, fetchFn?: FetchFn): Promise<Result<UpdateCheckData, AppError>> {
    return UpdateCheck.check(localVersion, fetchFn, 'mobile');
  }
}
