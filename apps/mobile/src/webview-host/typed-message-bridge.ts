/**
 * RN ↔ WebView 类型化 JSON 信封桥工厂（`{v, type, payload}`，三 webview 域共用）。
 *
 * 单源：本工厂是宿主侧 encode/decode 的唯一实现，`components/chat/ComposerInputBridge.ts`、
 * `components/vfs/CodeEditorBridge.ts`、`components/vfs/RichDocumentBridge.ts` 各自只留
 * 消息类型 + 版本常量 + 四函数别名。decode 走抛错口径（坏信封 = JSON 坏 / v 不符 /
 * type 缺失 / from-web 的 payload 非对象），由宿主 onMessage try/catch 静默丢弃；
 * 错误文案带域 label，逐字保留各桥原文案（测试按 /version|shape/ 断言）。
 *
 * 与 web 侧 `web/shared/host-message-channel.ts` 的关系：那边是宽容版（坏输入返回 null），
 * 供 webview bundle 丢弃宿主消息；本工厂是宿主侧的严格版，错误通道不同故不合并。
 */
import {Guards} from '@novel-master/core/common';

/** 四函数桥：ToClient = 宿主 → webview 的消息，ToHost = webview → 宿主的消息。 */
export interface TypedMessageBridge<ToClient, ToHost> {
    readonly encodeToClient: (message: ToClient) => string;
    readonly encodeToHost: (message: ToHost) => string;
    /** 解析 webview → 宿主的信封（校验 payload 为对象）。 */
    readonly decodeToHost: (raw: string) => ToHost;
    /** 解析宿主 → webview 的信封（不校验 payload，对齐三桥既有口径）。 */
    readonly decodeToClient: (raw: string) => ToClient;
}

/** 解析并校验信封：v 不符 → versionError，type 缺失 / payload 非对象（requirePayload）→ shapeError。 */
/** decodeEnvelope 的参数对象（>4 参签名收口）：信封原文与校验口径同对象，字段名即文档。 */
type DecodeEnvelopeParams = {
    /** webview → 宿主的原始 JSON 文本。 */
    readonly raw: string;
    /** true = webview → 宿主方向（校验 payload 为对象）；false = 宿主 → webview 方向（不校验）。 */
    readonly requirePayload: boolean;
    /** 信封版本（各桥自己的 BRIDGE_V，web 侧同值）。 */
    readonly version: number;
    /** v 不符时的错误文案（带域 label）。 */
    readonly versionError: string;
    /** type 缺失 / payload 非对象时的错误文案（带域 label）。 */
    readonly shapeError: string;
};

function decodeEnvelope(p: DecodeEnvelopeParams): unknown {
    const {raw, requirePayload, version, versionError, shapeError} = p;
    const parsed: unknown = JSON.parse(raw);
    if (!Guards.isRecord(parsed) || parsed.v !== version) {
        // nm-throw: keep — webview bridge 边界：坏信封由宿主 onMessage catch 后静默丢弃
        throw new Error(versionError);
    }
    if (typeof parsed.type !== 'string' || (requirePayload && !Guards.isRecord(parsed.payload))) {
        // nm-throw: keep — webview bridge 边界：坏信封由宿主 onMessage catch 后静默丢弃
        throw new Error(shapeError);
    }
    return parsed;
}

export const TypedMessageBridge = {
    /**
   * @param version 信封版本（各桥自己的 BRIDGE_V，web 侧同值）
   * @param label   错误文案里的域名（composer-input / code-editor / rich-document）
   */
    create: <ToClient, ToHost>(version: number, label: string): TypedMessageBridge<ToClient, ToHost> => {
        const versionError = `Invalid ${label} bridge envelope version`;
        const shapeError = `Invalid ${label} bridge envelope shape`;

        return {
            encodeToClient: message => JSON.stringify(message),
            encodeToHost: message => JSON.stringify(message),
            decodeToHost: raw => decodeEnvelope({raw, requirePayload: true, version, versionError, shapeError}) as ToHost,
            decodeToClient: raw => decodeEnvelope({raw, requirePayload: false, version, versionError, shapeError}) as ToClient,
        };
    },
} as const;
