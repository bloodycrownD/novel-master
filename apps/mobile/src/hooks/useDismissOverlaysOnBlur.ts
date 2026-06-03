import {useCallback} from 'react';
import {useFocusEffect} from '@react-navigation/native';

/** Calls dismiss when the hosting screen loses focus (Tab switch or Stack cover). */
export function useDismissOverlaysOnBlur(dismiss: () => void): void {
  useFocusEffect(
    useCallback(() => {
      // WHY: reset overlay state on blur so AppModal gate and BackHandler stay in sync
      return () => dismiss();
    }, [dismiss]),
  );
}
