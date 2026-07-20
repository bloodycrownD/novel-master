import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer from 'react-test-renderer';
import {PromptMacroTextInput} from '../src/components/agent/PromptMacroTextInput';
import {lightTheme} from '../src/theme/tokens';

describe('PromptMacroTextInput', () => {
  it('renders with macro value without value+children invariant error', () => {
    const onChangeText = jest.fn();
    expect(() =>
      TestRenderer.create(
        <PromptMacroTextInput
          tokens={lightTheme}
          value="前缀 {{$time}} 后缀"
          onChangeText={onChangeText}
        />,
      ),
    ).not.toThrow();
  });
});
