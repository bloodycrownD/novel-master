import type {EventBlockDraft} from '../src/components/events/event-config-state';
import {validateEventConfigBlocks} from '../src/components/events/validate-event-config-blocks';

const MSG_RECEIVED = 'session.message.received';
const COMPACTION = 'session.compaction.requested';

function draft(
  eventType: string,
  actions: EventBlockDraft['actions'],
): EventBlockDraft {
  return {
    id: 'b1',
    eventType,
    actions,
  };
}

describe('validateEventConfigBlocks', () => {
  it('rejects duplicate event types', () => {
    const err = validateEventConfigBlocks([
      draft(MSG_RECEIVED, [{type: 'refresh-macros', params: {}}]),
      draft(MSG_RECEIVED, [{type: 'refresh-macros', params: {}}]),
    ]);
    expect(err).toMatch(/重复/);
    expect(err).toMatch(/收到助手消息后/);
  });

  it('rejects duplicate action types in one event', () => {
    const err = validateEventConfigBlocks([
      draft(COMPACTION, [
        {type: 'hide-message', params: {startDepth: 6}},
        {type: 'hide-message', params: {startDepth: 3}},
      ]),
    ]);
    expect(err).toMatch(/隐藏消息/);
    expect(err).toMatch(/重复/);
  });

  it('accepts distinct actions', () => {
    expect(
      validateEventConfigBlocks([
        draft(COMPACTION, [
          {type: 'hide-message', params: {startDepth: 6}},
          {type: 'refresh-macros', params: {}},
        ]),
      ]),
    ).toBeNull();
  });

  it('rejects unknown dependency references', () => {
    const err = validateEventConfigBlocks([
      draft(COMPACTION, [
        {
          type: 'hide-message',
          params: {startDepth: 6},
          dependency: ['run-agent'],
        },
        {type: 'refresh-macros', params: {}},
      ]),
    ]);
    expect(err).toMatch(/依赖不存在/);
    expect(err).toMatch(/run-agent/);
  });

  it('rejects self dependency', () => {
    const err = validateEventConfigBlocks([
      draft(COMPACTION, [
        {
          type: 'hide-message',
          params: {startDepth: 6},
          dependency: ['hide-message'],
        },
      ]),
    ]);
    expect(err).toMatch(/不能依赖自身/);
  });

  it('rejects cycle dependencies', () => {
    const err = validateEventConfigBlocks([
      draft(COMPACTION, [
        {
          type: 'hide-message',
          params: {startDepth: 6},
          dependency: ['refresh-macros'],
        },
        {
          type: 'refresh-macros',
          params: {},
          dependency: ['hide-message'],
        },
      ]),
    ]);
    expect(err).toMatch(/循环/);
  });
});
