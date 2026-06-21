/**
 * Hermes polyfills for js-tiktoken, AWS SDK v3, and other web APIs (must load before App).
 * NMTP RN driver registers in getMobileConnection (see db/connection.ts).
 */
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import 'fast-text-encoding';
import {Buffer} from 'buffer';
import {ReadableStream} from 'web-streams-polyfill';
import {DOMParser} from '@xmldom/xmldom';

declare const globalThis: {
  Buffer?: typeof Buffer;
  ReadableStream?: typeof ReadableStream;
  DOMParser?: typeof DOMParser;
  Node?: typeof Node;
};

globalThis.Buffer = Buffer;
globalThis.ReadableStream = ReadableStream;

// Hermes 无 DOMParser / Node，AWS SDK browser XML 解析器会 ReferenceError
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
