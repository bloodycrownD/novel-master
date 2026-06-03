import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {
  useAndroidChatBackHandler,
  type AndroidChatBackActions,
  type AndroidChatBackState,
} from '../src/hooks/useAndroidChatBackHandler';

let capturedHandler: (() => boolean) | undefined;
const mockRemove = jest.fn();

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  BackHandler: {
    addEventListener: jest.fn((_event: string, handler: () => boolean) => {
      capturedHandler = handler;
      return {remove: mockRemove};
    }),
  },
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    return cleanup;
  },
}));

function defaultState(
  overrides: Partial<AndroidChatBackState> = {},
): AndroidChatBackState {
  return {
    chatSubview: 'sessions',
    sessionListPanel: 'sessions',
    sessionDrawerOpen: false,
    messageMenuOpen: false,
    messageBatchActive: false,
    messageEditOpen: false,
    modelPickerOpen: false,
    agentPickerOpen: false,
    sessionRenameOpen: false,
    projectDrawerOpen: false,
    sessionBatchActive: false,
    ...overrides,
  };
}

function defaultActions(
  overrides: Partial<AndroidChatBackActions> = {},
): AndroidChatBackActions {
  return {
    backFromConversation: jest.fn(),
    closeSessionDrawer: jest.fn(),
    closeMessageMenu: jest.fn(),
    exitMessageBatch: jest.fn(),
    closeMessageEdit: jest.fn(),
    closeModelPicker: jest.fn(),
    closeAgentPicker: jest.fn(),
    closeSessionRename: jest.fn(),
    closeProjectDrawer: jest.fn(),
    exitSessionBatch: jest.fn(),
    showSessionsPanel: jest.fn(),
    ...overrides,
  };
}

function TestHost({
  state,
  actions,
}: {
  state: AndroidChatBackState;
  actions: AndroidChatBackActions;
}) {
  useAndroidChatBackHandler(state, actions);
  return null;
}

describe('useAndroidChatBackHandler', () => {
  beforeEach(() => {
    capturedHandler = undefined;
    mockRemove.mockClear();
    jest.clearAllMocks();
  });

  function mountAndGetHandler(
    state: AndroidChatBackState,
    actions: AndroidChatBackActions,
  ): () => boolean {
    act(() => {
      TestRenderer.create(
        React.createElement(TestHost, {state, actions}),
      );
    });
    expect(capturedHandler).toBeDefined();
    return capturedHandler!;
  }

  it('T-B1: conversation subview intercepts back and calls backFromConversation', () => {
    const backFromConversation = jest.fn();
    const handler = mountAndGetHandler(
      defaultState({chatSubview: 'conversation'}),
      defaultActions({backFromConversation}),
    );

    expect(handler()).toBe(true);
    expect(backFromConversation).toHaveBeenCalledTimes(1);
  });

  it('T-B2: session list with no overlays returns false', () => {
    const backFromConversation = jest.fn();
    const handler = mountAndGetHandler(
      defaultState({chatSubview: 'sessions'}),
      defaultActions({backFromConversation}),
    );

    expect(handler()).toBe(false);
    expect(backFromConversation).not.toHaveBeenCalled();
  });

  it('T-B3: session drawer closes first without leaving conversation', () => {
    const backFromConversation = jest.fn();
    const closeSessionDrawer = jest.fn();
    const handler = mountAndGetHandler(
      defaultState({
        chatSubview: 'conversation',
        sessionDrawerOpen: true,
      }),
      defaultActions({backFromConversation, closeSessionDrawer}),
    );

    expect(handler()).toBe(true);
    expect(closeSessionDrawer).toHaveBeenCalledTimes(1);
    expect(backFromConversation).not.toHaveBeenCalled();
  });

  it('T-B4: agent picker closes first without leaving conversation', () => {
    const backFromConversation = jest.fn();
    const closeAgentPicker = jest.fn();
    const handler = mountAndGetHandler(
      defaultState({
        chatSubview: 'conversation',
        agentPickerOpen: true,
      }),
      defaultActions({backFromConversation, closeAgentPicker}),
    );

    expect(handler()).toBe(true);
    expect(closeAgentPicker).toHaveBeenCalledTimes(1);
    expect(backFromConversation).not.toHaveBeenCalled();
  });
});
