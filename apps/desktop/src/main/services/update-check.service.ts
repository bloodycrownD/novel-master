/**
 * Desktop update-check service — 平台薄壳：只提供 Electron 的本地版本号，
 * 网络/解析/比较全部走 core `UpdateCheck`。
 */

import { app } from "electron";
import { type AppError, Result } from "@novel-master/core/errors";
import { UpdateCheck, type UpdateCheckData } from "@novel-master/core/common";

// nm-style: keep-public — app-info.ts:32 经动态 import() 解构消费（检查器只解析静态 import）
export async function runUpdateCheck(): Promise<Result<UpdateCheckData, AppError>> {
  const localVersion = app.getVersion();
  return UpdateCheck.check(localVersion);
}
