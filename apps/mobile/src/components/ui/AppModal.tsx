/**
 * RN Modal wrapper with navigation focus gate.
 * Prevents unfocused Tab screens from leaving native Modal overlays
 * that block touch and Android back after Tab/Stack navigation.
 */
import React from 'react';
import {Modal, type ModalProps} from 'react-native';
import {useIsFocused} from '@react-navigation/native';

export function AppModal({visible, ...rest}: ModalProps) {
  const isFocused = useIsFocused();
  // WHY: unfocused hosts must not show native Modal even if local state is still true
  const effectiveVisible = Boolean(visible && isFocused);
  return <Modal visible={effectiveVisible} {...rest} />;
}
