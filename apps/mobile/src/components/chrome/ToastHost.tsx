/**
 * Lightweight toast overlay (PRD F2 rollback success feedback).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../theme/ThemeProvider';

type ToastContextValue = {
  showToast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx == null) {
    throw new Error('useToast must be used within ToastHost');
  }
  return ctx;
}

const TOAST_MS = 2500;

export function ToastHost({children}: {children: ReactNode}) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const showToast = useCallback((msg: string) => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
    }
    setMessage(msg);
    timerRef.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  return (
    <ToastContext.Provider value={{showToast}}>
      {children}
      {message != null ? (
        <View
          pointerEvents="none"
          style={[
            styles.toast,
            {
              bottom: insets.bottom + 16,
              backgroundColor: tokens.surfaceElevated,
              borderColor: tokens.border,
            },
          ]}>
          <Text style={[styles.text, {color: tokens.text}]}>{message}</Text>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
  },
  text: {fontSize: 14, textAlign: 'center'},
});
