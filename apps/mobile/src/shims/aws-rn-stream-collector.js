/**
 * RN 兼容响应体收集：统一将 Blob / Readable / mixin stream 转为 Uint8Array。
 */
const {streamCollector: fetchStreamCollector} = require('@smithy/fetch-http-handler');
const {fromBase64, sdkStreamMixin, Uint8ArrayBlobAdapter} = require('@smithy/core/serde');

function isNodeReadable(stream) {
  return (
    stream != null &&
    typeof stream === 'object' &&
    typeof stream.on === 'function' &&
    typeof stream.read === 'function' &&
    typeof stream.getReader !== 'function'
  );
}

function collectNodeReadable(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const onData = chunk => {
      if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
        return;
      }
      chunks.push(new Uint8Array(Buffer.from(chunk)));
    };
    const onEnd = () => {
      cleanup();
      const total = chunks.reduce((sum, part) => sum + part.byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const part of chunks) {
        out.set(part, offset);
        offset += part.byteLength;
      }
      resolve(out);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.off?.('data', onData);
      stream.off?.('end', onEnd);
      stream.off?.('error', onError);
      stream.removeListener?.('data', onData);
      stream.removeListener?.('end', onEnd);
      stream.removeListener?.('error', onError);
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    if (typeof stream.resume === 'function') {
      stream.resume();
    }
  });
}

function readBlobAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.readyState !== 2) {
        reject(new Error('FileReader aborted too early'));
        return;
      }
      const result = reader.result ?? '';
      const commaIndex = String(result).indexOf(',');
      const dataOffset = commaIndex > -1 ? commaIndex + 1 : String(result).length;
      resolve(String(result).substring(dataOffset));
    };
    reader.onabort = () => reject(new Error('Read aborted'));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

async function collectBlobBytes(blob) {
  if (typeof FileReader === 'function') {
    const base64 = await readBlobAsBase64(blob);
    return new Uint8Array(fromBase64(base64));
  }
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  throw new TypeError('[cloud-sync] 无法读取 Blob 响应体（缺少 FileReader / arrayBuffer）');
}

/** 将 fetch / Smithy 响应体规范为 Uint8Array。 */
async function collectResponseBytes(body) {
  if (body == null) {
    return new Uint8Array();
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray();
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }
  if (
    typeof Blob === 'function' &&
    (body instanceof Blob || body?.constructor?.name === 'Blob')
  ) {
    return collectBlobBytes(body);
  }
  if (typeof body.getReader === 'function' && !isNodeReadable(body)) {
    return fetchStreamCollector(body);
  }
  if (isNodeReadable(body)) {
    return collectNodeReadable(body);
  }
  return fetchStreamCollector(body);
}

function createRnStreamCollector() {
  return stream => collectResponseBytes(stream);
}

function toSdkPayloadBytes(bytes) {
  return Uint8ArrayBlobAdapter.mutate(bytes);
}

/** GetObject 等会再次 sdkStreamMixin(body)，须为 Blob / ReadableStream。 */
function toSdkResponseBody(bytes) {
  if (bytes.byteLength === 0) {
    return sdkStreamMixin(new Blob([]));
  }
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return sdkStreamMixin(stream);
}

module.exports = {
  collectResponseBytes,
  createRnStreamCollector,
  toSdkPayloadBytes,
  toSdkResponseBody,
  isNodeReadable,
};
