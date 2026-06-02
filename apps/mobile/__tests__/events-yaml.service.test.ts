import {describe, expect, it, jest} from '@jest/globals';
jest.mock('react-native-blob-util', () => ({default: {fs: {}}}));
jest.mock('@react-native-documents/picker', () => ({}));
import {decodeEventsYamlText} from '../src/services/events-yaml.service';

describe('events-yaml.service', () => {
  it('rejects malformed yaml', () => {
    expect(() => decodeEventsYamlText('schemaVersion: [2')).toThrow();
  });

  it('rejects invalid events schema', () => {
    const yaml = `
schemaVersion: 2
events:
  app.start:
    - run-agent: {}
`;
    expect(() => decodeEventsYamlText(yaml)).toThrow();
  });
});
