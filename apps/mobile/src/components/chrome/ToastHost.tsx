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
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../theme/ThemeProvider';

export type ToastOptions = {
  actionLabel?: string;
  onAction?: () => void;
};

type ToastState = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

type ToastContextValue = {
  showToast: (message: string, options?: ToastOptions) => void;
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
const ACTION_TOAST_MS = 8000;

export function ToastHost({children}: {children: ReactNode}) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const showToast = useCallback((msg: string, options?: ToastOptions) => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
    }
    setToast({
      message: msg,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
    });
    const duration = options?.actionLabel ? ACTION_TOAST_MS : TOAST_MS;
    timerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  const hasAction = Boolean(toast?.actionLabel && toast.onAction);

  return (
    <ToastContext.Provider value={{showToast}}>
      {children}
      {toast != null ? (
        <View
          testID="toast-message"
          pointerEvents={hasAction ? 'box-none' : 'none'}
          style={[
            styles.toast,
            {
              bottom: insets.bottom + 16,
              backgroundColor: tokens.surfaceElevated,
              borderColor: tokens.border,
            },
          ]}>
          <Text style={[styles.text, {color: tokens.text}]}>{toast.message}</Text>
          {hasAction ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                toast.onAction?.();
                if (timerRef.current != null) {
                  clearTimeout(timerRef.current);
                }
                setToast(null);
              }}
              style={({pressed}) => [
                styles.action,
                {
                  backgroundColor: pressed
                    ? tokens.bgSecondary
                    : tokens.borderLight,
                },
              ]}>
              <Text style={[styles.actionText, {color: tokens.primary}]}>
                {toast.actionLabel}
              </Text>
            </Pressable>
          ) : null}
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
    gap: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
  },
  text: {fontSize: 14, textAlign: 'center'},
  action: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
