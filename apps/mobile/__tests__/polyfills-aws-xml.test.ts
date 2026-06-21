/**
 * Hermes 无 DOMParser/Node 时，polyfill 须使 AWS SDK browser XML 解析器可用。
 */
jest.mock('react-native-get-random-values', () => ({}));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('fast-text-encoding', () => ({}));

import {parseXML} from '@aws-sdk/xml-builder';

describe('polyfills-aws-xml', () => {
  const sample =
    '<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>...</Message></Error>';

  beforeAll(() => {
    delete (globalThis as {DOMParser?: unknown; Node?: unknown}).DOMParser;
    delete (globalThis as {DOMParser?: unknown; Node?: unknown}).Node;
    // 须在 delete 之后加载，静态 import 会被提升
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../src/polyfills');
  });

  it('注入 DOMParser 与 Node 常量', () => {
    expect(globalThis.DOMParser).toBeDefined();
    expect(globalThis.Node?.ELEMENT_NODE).toBe(1);
    expect(globalThis.Node?.TEXT_NODE).toBe(3);
  });

  it('polyfill 后 parseXML 解析 S3 错误 XML 不抛 ReferenceError', () => {
    expect(() => parseXML(sample)).not.toThrow();
    expect(parseXML(sample).Error.Code).toBe('NoSuchBucket');
  });
});
