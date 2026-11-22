/**
 * User-visible error messages for Core domain errors (VFS, chat, provider, tools, agent).
 *
 * 分派链 8 条顺序硬写（VFS_* → PROVIDER_* → CLOUD_SYNC_* → 通配），与 desktop
 * `format-ipc-error` 逐条对齐；desktop 第 1 条 ZodError 是 desktop 独有入口，
 * mobile 无该分支（T-A4 镜像门对此条豁免）。本函数只产文案字符串，不产 code。
 */
import {TdbcError} from '@novel-master/core';
import {AppErrorOps, ErrorGuards} from '@novel-master/core/errors';
import {Errors} from '@novel-master/core/common';
import {VfsErrorForUser} from '@novel-master/core/vfs';
import {coreT} from '@/i18n/core';

export namespace FormatError {
    /** core VfsErrorForUser.format（descriptor）→ 中文 string。 */
    export function formatVfsForUser(error: unknown, scope?: Parameters<typeof VfsErrorForUser.format>[1]): string {
        return coreT(VfsErrorForUser.format(error, scope));
    }

    function read(error: Error): unknown {
        return (error as Error & {cause?: unknown}).cause;
    }

    /** Formats an error for on-screen display; unwraps known Core error types. */
    export function format(error: unknown): string {
        // 1. VFS_*：AppError 且 code 落 VFS 域段（102 VFS + 103 VFS_CHARACTER_CARD），
        //    域判定走 domainOf（spec-3 §3.7），不依赖 key 命名约定。core service 已直抛
        //    AppError（三期 Step 6 删 legacy mapper），不设历史对象兜底。
        if (AppErrorOps.is(error) && (ErrorGuards.domainOf(error.code) === 'VFS' || ErrorGuards.domainOf(error.code) === 'VFS_CHARACTER_CARD')) {
            return formatVfsForUser(error);
        }
        // 2. PROVIDER_*：文案走码表 messageKey + coreT（原两条硬编码中文已进 catalog）。
        if (AppErrorOps.is(error) && ErrorGuards.domainOf(error.code) === 'PROVIDER') {
            return Errors.visibleMessage(error, error.message, coreT);
        }
        // 3. CLOUD_SYNC_*：文案走码表 messageKey / 构造点 descriptor。
        if (AppErrorOps.is(error) && ErrorGuards.domainOf(error.code) === 'CLOUD_SYNC') {
            return Errors.visibleMessage(error, error.message, coreT);
        }
        // 4. 旧 ToolError 的 VFS cause 解包：类已退役，等价判 TOOL_FAILED；cause 双写在
        //    Error.cause 与 details.cause（一期 spec §2.5）。VFS cause 透传 vfs 文案。
        if (AppErrorOps.is(error, 'TOOL_FAILED')) {
            const cause = read(error) ?? (error.details as {cause?: unknown} | undefined)?.cause;
            if (AppErrorOps.is(cause) && (ErrorGuards.domainOf(cause.code) === 'VFS' || ErrorGuards.domainOf(cause.code) === 'VFS_CHARACTER_CARD')) {
                return formatVfsForUser(cause);
            }
            const fallback = cause instanceof Error ? cause.message : error.message;
            return Errors.visibleMessage(error, fallback, coreT);
        }
        // 5. 其余 AppError 通配 → ErrorMessage.userOf + coreT，未覆盖回退原 message。
        if (AppErrorOps.is(error)) {
            return Errors.visibleMessage(error, error.message, coreT);
        }
        // 6. TdbcError：message + cause。
        if (error instanceof TdbcError) {
            const causeValue = read(error);
            const inner = causeValue instanceof Error && causeValue.message ? causeValue.message : causeValue != null ? String(causeValue) : undefined;
            return inner ? `${error.message}\n${inner}` : error.message;
        }
        // 7. 未知 Error。
        if (error instanceof Error) {
            return error.message;
        }
        // 8. 非 Error 抛出值。
        return String(error);
    }
}
