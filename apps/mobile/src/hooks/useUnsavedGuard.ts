/**
 * Blocks navigation when the editor has unsaved changes.
 */
import {useCallback, useEffect, useRef} from 'react';
import {Alert} from 'react-native';
import {useNavigation} from '@react-navigation/native';

/** Confirm before leaving a screen with dirty editor state. */
export function useUnsavedGuard(
  isDirty: boolean,
  message = '有未保存的更改，确定离开？',
): {allowLeaveWithoutPrompt: () => void} {
  const navigation = useNavigation();
  const allowLeaveRef = useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', event => {
      if (allowLeaveRef.current) {
        allowLeaveRef.current = false;
        return;
      }
      if (!isDirty) {
        return;
      }
      event.preventDefault();
      Alert.alert('未保存', message, [
        {text: '留下', style: 'cancel'},
        {
          text: '离开',
          style: 'destructive',
          onPress: () => navigation.dispatch(event.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, isDirty, message]);

  const allowLeaveWithoutPrompt = useCallback(() => {
    allowLeaveRef.current = true;
  }, []);

  return {allowLeaveWithoutPrompt};
}
