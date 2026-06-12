/**
 * Hermes polyfills for js-tiktoken, AWS SDK v3, and other web APIs (must load before App).
 * NMTP RN driver registers in getMobileConnection (see db/connection.ts).
 */
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import 'fast-text-encoding';
import {Buffer} from 'buffer';
import {ReadableStream} from 'web-streams-polyfill/dist/polyfill.js';

declare const globalThis: {
  Buffer?: typeof Buffer;
  ReadableStream?: typeof ReadableStream;
};

globalThis.Buffer = Buffer;
globalThis.ReadableStream = ReadableStream;
