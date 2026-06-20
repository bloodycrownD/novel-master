/**
 * 鐢ㄦ埛 VFS UA 涓ゆ鐢ㄤ緥绔彛銆?
 *
 * @module service/chat/user-vfs-turn.port
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";

/** 鍗曟 VFS 鎿嶄綔涓殑 tool 璋冪敤瑙勬牸锛堝惈 flush 閰嶅鐢?id锛夈€?*/
export interface UserVfsTurnToolSpec {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** `executeOp` 鍏ュ弬锛歛ction XML 鐪熸簮 + 寰呮墽琛岀殑 tool 鍒楄〃銆?*/
export interface UserVfsTurnOp {
  readonly actionXml: string;
  readonly tools: readonly UserVfsTurnToolSpec[];
}

/** `executeOp` 鎵ц缁撴灉銆?*/
export type UserVfsTurnExecuteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown; readonly partialFailure?: true };

/** `flushPendingUserVfsTurns` 鎵ц缁撴灉銆?*/
export interface UserVfsFlushResult {
  /** 鏄惁瀹為檯钀藉簱浜?UA 涓ゆ锛坧ending 闈炵┖鏃朵负 true锛夈€?*/
  readonly flushed: boolean;
}

/**
 * 鐢ㄦ埛 VFS 鎿嶄綔缂栨帓锛氬嵆鏃?ToolRunner 鎵ц + pending 闃熷垪 + flush 钀藉簱 UA 涓ゆ銆?
 */
export interface UserVfsTurnService {
  /**
   * 鎵ц鍚堟垚 tool 骞?append pending锛涘け璐ヤ笉鍐?pending銆?
   */
  executeOp(
    sessionId: string,
    op: UserVfsTurnOp,
  ): Promise<UserVfsTurnExecuteResult>;

  /**
   * pending 闈炵┖鏃?merge 骞?append 2 鏉?UA锛屾竻绌?pending锛宑apture checkpoint 涓€娆★紙閿?U 鏉★級銆?
   *
   * @remarks flush 绂佹鍐嶆璋冪敤 ToolRunner銆?
   */
  flushPendingUserVfsTurns(sessionId: string): Promise<UserVfsFlushResult>;

  /** 浼氳瘽鏄惁瀛樺湪寰?flush 鐨?VFS pending 鏉＄洰銆?*/
  hasPendingTurns(sessionId: string): Promise<boolean>;
}

/** 妗ユ帴 assistant 杩藉姞鍑芥暟锛坢axSteps 寮圭獥鍦烘櫙锛沝eps 鐢卞伐鍘傜粦瀹氾級銆?*/
export type AppendToolTurnBridgeFn = (
  sessionId: string,
) => Promise<ChatMessage>;
