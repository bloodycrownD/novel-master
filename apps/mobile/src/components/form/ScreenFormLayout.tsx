/**
 * Scrollable form screen with optional sticky footer.
 */
import React, {type ReactNode} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';
import {FormOverlayProvider} from './FormOverlayHost';

type Props = {
  tokens: ThemeTokens;
  children: ReactNode;
  footer?: ReactNode;
  /** Disable scroll while a modal/sheet is open to avoid background bleed. */
  scrollEnabled?: boolean;
};

export function ScreenFormLayout({
  tokens,
  children,
  footer,
  scrollEnabled = true,
}: Props) {
  return (
    <FormOverlayProvider>
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <ScrollView
          scrollEnabled={scrollEnabled}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer}
      </View>
    </FormOverlayProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {paddingTop: 16, paddingBottom: 24},
});
