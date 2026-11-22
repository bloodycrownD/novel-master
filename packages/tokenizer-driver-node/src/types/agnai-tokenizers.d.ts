declare module "@agnai/sentencepiece-js" {
    export class SentencePieceProcessor {
        /** nm-style: keep-public — @agnai/sentencepiece-js 外部模块 API 声明，非本仓实现。 */
        load(url: string): Promise<void>;
        /** nm-style: keep-public — @agnai/sentencepiece-js 外部模块 API 声明，非本仓实现。 */
        encodeIds(text: string): number[];
        /** nm-style: keep-public — @agnai/sentencepiece-js 外部模块 API 声明，非本仓实现。 */
        encodePieces(text: string): string[];
        /** nm-style: keep-public — @agnai/sentencepiece-js 外部模块 API 声明，非本仓实现。 */
        decodeIds(ids: number[]): string;
    }
    export function cleanText(text: string): string;
}

declare module "@agnai/web-tokenizers" {
    export class Tokenizer {
        encode(text: string): Int32Array;
        decode(ids: Int32Array): string;
        dispose(): void;
        static fromJSON(json: ArrayBuffer): Promise<Tokenizer>;
    }
}
