/**
 * Renders form overlays (pickers, sheets) above scroll content and sticky footers.
 * Modals nested inside ScrollView may not cover sibling footers on Android.
 */
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {StyleSheet, View} from 'react-native';

type OverlayApi = {
  show: (key: string, node: ReactNode) => void;
  hide: (key: string) => void;
};

const FormOverlayContext = createContext<OverlayApi | null>(null);

export function FormOverlayProvider({children}: {children: ReactNode}) {
  const [layers, setLayers] = useState<Record<string, ReactNode>>({});

  const show = useCallback((key: string, node: ReactNode) => {
    setLayers(prev => ({...prev, [key]: node}));
  }, []);

  const hide = useCallback((key: string) => {
    setLayers(prev => {
      if (!(key in prev)) {
        return prev;
      }
      const next = {...prev};
      delete next[key];
      return next;
    });
  }, []);

  const api = useMemo(() => ({show, hide}), [show, hide]);
  const hasLayers = Object.keys(layers).length > 0;

  return (
    <FormOverlayContext.Provider value={api}>
      <View style={styles.wrapper}>
        {children}
        {hasLayers ? (
          <View style={styles.host} pointerEvents="box-none">
            {Object.entries(layers).map(([key, node]) => (
              <View key={key} style={styles.layer} pointerEvents="auto">
                {node}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </FormOverlayContext.Provider>
  );
}

export function useFormOverlay(): OverlayApi | null {
  return useContext(FormOverlayContext);
}

const styles = StyleSheet.create({
  wrapper: {flex: 1},
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    elevation: 100,
  },
  layer: {
    ...StyleSheet.absoluteFill,
  },
});
