/**
 * RN 云同步响应体收集：Blob / mixin stream → Uint8Array。
 */
jest.mock('react-native-get-random-values', () => ({}));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('fast-text-encoding', () => ({}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../src/polyfills');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  collectResponseBytes,
  toSdkPayloadBytes,
  toSdkResponseBody,
} = require('../src/shims/aws-rn-stream-collector');

describe('aws-rn-stream-collector', () => {
  it('collectResponseBytes 读取 Blob 文本', async () => {
    const blob = new Blob(['<ListBucketResult/>'], {type: 'application/xml'});
    const bytes = await collectResponseBytes(blob);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe('<ListBucketResult/>');
  });

  it('collectResponseBytes 读取 sdkStreamMixin 包装体', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {sdkStreamMixin} = require('@smithy/core/serde');
    const mixed = sdkStreamMixin(new Blob(['ok']));
    const bytes = await collectResponseBytes(mixed);
    expect(new TextDecoder().decode(bytes)).toBe('ok');
  });

  it('toSdkPayloadBytes 包装 Uint8Array 供 Smithy collectBody 使用', () => {
    const payload = toSdkPayloadBytes(new Uint8Array([1, 2, 3]));
    expect(payload).toBeInstanceOf(Uint8Array);
    expect(payload.byteLength).toBe(3);
    expect(typeof payload.transformToString).toBe('function');
  });

  it('toSdkResponseBody 空字节用空 Blob（Hermes 不支持 Blob([Uint8Array])）', async () => {
    const body = toSdkResponseBody(new Uint8Array());
    const bytes = await body.transformToByteArray();
    expect(bytes.byteLength).toBe(0);
  });

  it('toSdkResponseBody 非空字节用 ReadableStream', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {sdkStreamMixin} = require('@smithy/core/serde');
    const body = toSdkResponseBody(new Uint8Array([123, 125]));
    expect(() => sdkStreamMixin(body)).not.toThrow();
    const bytes = await body.transformToByteArray();
    expect(new TextDecoder().decode(bytes)).toBe('{}');
  });

  it('collectResponseBytes 空 body 返回空 Uint8Array', async () => {
    const bytes = await collectResponseBytes(null);
    expect(bytes.byteLength).toBe(0);
  });
});
