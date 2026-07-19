import {SimpleEventBus} from '@novel-master/core/events';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {
  clearAllScrollSnapshots,
  scrollCacheKey,
  setScrollSnapshot,
} from '../src/services/chat-list-scroll-cache';
import {emitChatTranscriptTelemetry} from '../src/services/chat-transcript-telemetry';

const mockEmitTelemetry = emitChatTranscriptTelemetry as jest.MockedFunction<
  typeof emitChatTranscriptTelemetry
>;

jest.mock('../src/services/chat-transcript-telemetry', () => ({
  CHAT_TRANSCRIPT_TELEMETRY_ENABLED: true,
  emitChatTranscriptTelemetry: jest.fn(),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn()},
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => cb(),
  useNavigation: () => ({navigate: jest.fn(), setOptions: jest.fn()}),
  useIsFocused: () => true,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@novel-master/core', () => ({
  EVENT_SESSION_COMPACTION_REQUESTED: 'session.compact',
  textBlocks: (text: string) => ({blocks: [{type: 'text', text}]}),
}));

const mockRuntime: any = {
  projects: {
    list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
    get: jest.fn(async () => ({id: 'p1', name: 'P1'})),
  },
  sessions: {
    listByProject: jest.fn(async () => [{id: 's1', title: 'S1', updatedAtMs: 1}]),
  },
  messages: {
    listBySession: jest.fn(async () => []),
    listBySessionPage: jest.fn(async () => []),
  },
  state: {
    getCurrentModelId: jest.fn(async () => 'openai/gpt-4o-mini'),
    getCurrentRegexGroupId: jest.fn(async () => undefined),
  },
  eventOrchestrator: {emit: jest.fn()},
  eventBus: new SimpleEventBus(),
  worktree: jest.fn(() => ({})),
  sessionVfs: jest.fn(() => ({})),
  projectVfs: jest.fn(() => ({})),
};

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('../src/hooks/useMobileScope', () => ({
  useMobileScope: () => ({
    projectId: 'p1',
    sessionId: 's1',
    setCurrentProject: jest.fn(async () => undefined),
    setCurrentSession: jest.fn(async () => undefined),
    refreshScope: jest.fn(async () => undefined),
  }),
}));

jest.mock('../src/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setChat: jest.fn()}),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

jest.mock('../src/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({
    appUi: {get: jest.fn(async () => 'false')},
    richRenderEpoch: 0,
  }),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surfaceElevated: '#111',
      borderLight: '#222',
      textSecondary: '#ccc',
      primary: '#08f',
      text: '#fff',
      textTertiary: '#777',
    },
  }),
}));

jest.mock('../src/services/chat-agent-meta', () => ({
  loadChatAgentMeta: jest.fn(async () => ({
    agentId: 'a1',
    agentName: 'Agent',
    modelLabel: 'Model',
    tokenLabel: '',
    hasDedicatedModel: false,
  })),
}));

jest.mock('../src/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => ''),
}));

jest.mock('../src/storage/chat-rich-text-pref', () => ({
  readChatRichTextEnabled: jest.fn(async () => false),
}));

jest.mock('../src/services/regex-apply-channel', () => ({
  loadSessionMessagesTailForDisplay: jest.fn(async () => []),
  loadSessionMessagesPageForDisplay: jest.fn(async () => []),
}));

jest.mock('../src/services/stream-apply-buffer', () => ({
  createStreamApplyBuffer: () => ({
    push: jest.fn(),
    pushAll: jest.fn(),
    flush: jest.fn(),
    reset: jest.fn(),
    dispose: jest.fn(),
  }),
}));

jest.mock('../src/storage/chat-stream-batch-pref', () => ({
  readChatStreamBatchEnabled: jest.fn(async () => true),
}));

jest.mock('../src/storage/chat-transcript-engine', () => ({
  defaultChatTranscriptEngine: () => 'webview',
  readChatTranscriptEngine: jest.fn(async () => 'webview'),
}));

jest.mock('../src/components/chat/ChatTranscriptWebView', () => ({
  ChatTranscriptWebView: () => null,
}));

jest.mock('../src/components/chat/MessageList', () => ({
  MessageList: () => null,
}));

jest.mock('../src/components/chrome/AppHeader', () => ({AppHeader: () => null}));
jest.mock('../src/components/chat/ChatMetaBar', () => ({ChatMetaBar: () => null}));
jest.mock('../src/components/chat/ChatComposer', () => ({ChatComposer: () => null}));
jest.mock('../src/components/chat/MessageActionMenu', () => ({
  MessageActionMenu: () => null,
}));
jest.mock('../src/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: () => null,
}));
jest.mock('../src/components/chrome/ProjectDrawer', () => ({
  ProjectDrawer: () => null,
}));
jest.mock('../src/components/chrome/SessionActionsDrawer', () => ({
  SessionActionsDrawer: () => null,
}));
jest.mock('../src/components/provider/ModelPickerModal', () => ({
  ModelPickerModal: () => null,
}));
jest.mock('../src/components/vfs/VfsFileManager', () => ({
  VfsFileManager: () => null,
}));
jest.mock('../src/components/batch/ManageHeader', () => ({ManageHeader: () => null}));
jest.mock('../src/components/batch/BatchCheckbox', () => ({
  BatchCheckbox: () => null,
}));
jest.mock('../src/components/ui/SegmentedControl', () => ({
  SegmentedControl: () => null,
}));
jest.mock('../src/components/ui/PrototypeButtons', () => ({
  PrimaryButton: () => null,
}));
jest.mock('../src/components/ui/TextPromptModal', () => ({
  TextPromptModal: () => null,
}));
jest.mock('../src/components/agent/AgentPickerModal', () => ({
  AgentPickerModal: () => null,
}));
jest.mock('../src/components/chat/MessageEditModal', () => ({
  MessageEditModal: () => null,
}));

jest.mock('../src/hooks/useAndroidChatBackHandler', () => ({
  useAndroidChatBackHandler: jest.fn(),
}));
jest.mock('../src/hooks/useDismissOverlaysOnBlur', () => ({
  useDismissOverlaysOnBlur: jest.fn(),
}));

import {ChatTabScreen} from '../src/screens/tabs/ChatTabScreen';

describe('ChatTabScreen legacy scroll cache', () => {
  beforeEach(() => {
    clearAllScrollSnapshots();
    mockEmitTelemetry.mockClear();
  });

  afterEach(() => {
    clearAllScrollSnapshots();
  });

  it('emits legacy_cache_discarded when v1 snapshot is read under webview engine', async () => {
    const key = scrollCacheKey('p1', 's1');
    setScrollSnapshot(key, {offsetY: 40, nearBottom: false});

    await act(async () => {
      TestRenderer.create(<ChatTabScreen />);
    });

    expect(mockEmitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'legacy_cache_discarded',
        reason: 'wrong_version',
      }),
    );
    expect(
      mockEmitTelemetry.mock.calls.find(
        c => c[0]?.name === 'legacy_cache_discarded',
      )?.[0],
    ).not.toHaveProperty('seenVersion');
  });
});
