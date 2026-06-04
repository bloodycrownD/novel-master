declare module "@agnai/sentencepiece-js" {
  export class SentencePieceProcessor {
    load(url: string): Promise<void>;
    encodeIds(text: string): number[];
    encodePieces(text: string): string[];
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
