/**
 * Hermes polyfills for js-tiktoken, AWS SDK v3, and other web APIs (must load before App).
 * NMTP RN driver registers in getMobileConnection (see db/connection.ts).
 */
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import 'fast-text-encoding';
import {Buffer} from 'buffer';
import {ReadableStream, TransformStream} from 'web-streams-polyfill';
import {DOMParser} from '@xmldom/xmldom';

declare const globalThis: {
  Buffer?: typeof Buffer;
  ReadableStream?: typeof ReadableStream;
  TransformStream?: typeof TransformStream;
  DOMParser?: typeof DOMParser;
  Node?: typeof Node;
  Blob?: typeof Blob;
};

globalThis.Buffer = Buffer;
globalThis.ReadableStream = ReadableStream;
if (typeof globalThis.TransformStream === 'undefined') {
  globalThis.TransformStream = TransformStream;
}

// DOMParser polyfill 为兜底；RN bundle 经 Metro 使用 fast-xml-parser shim
if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = DOMParser as unknown as typeof DOMParser;
}

if (typeof globalThis.Node === 'undefined') {
  globalThis.Node = {
    ELEMENT_NODE: 1,
    ATTRIBUTE_NODE: 2,
    TEXT_NODE: 3,
    CDATA_SECTION_NODE: 4,
    ENTITY_REFERENCE_NODE: 5,
    ENTITY_NODE: 6,
    PROCESSING_INSTRUCTION_NODE: 7,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_TYPE_NODE: 10,
    DOCUMENT_FRAGMENT_NODE: 11,
  } as unknown as typeof Node;
}

/** AWS SDK fetch 响应体为 Blob 时，RN 自带 arrayBuffer 可能异常；有 FileReader 时强制走 FileReader */
if (
  typeof globalThis.Blob !== 'undefined' &&
  typeof FileReader === 'function'
) {
  globalThis.Blob.prototype.arrayBuffer = function arrayBufferPolyfill(
    this: Blob,
  ): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
          return;
        }
        reject(new Error('Blob.arrayBuffer polyfill: 无法读取 ArrayBuffer'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader 失败'));
      reader.readAsArrayBuffer(this);
    });
  };
} else if (
  typeof globalThis.Blob !== 'undefined' &&
  typeof globalThis.Blob.prototype.arrayBuffer !== 'function'
) {
  globalThis.Blob.prototype.arrayBuffer = function arrayBufferPolyfill(
    this: Blob,
  ): Promise<ArrayBuffer> {
    return Promise.reject(
      new Error('Blob.arrayBuffer polyfill: FileReader 不可用'),
    );
  };
}

