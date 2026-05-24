/**
 * Root shell: warms VFS on launch and toggles home vs dev screen.
 */
import React, {useEffect, useState} from 'react';
import {StatusBar, StyleSheet, useColorScheme, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {HomeScreen} from './screens/HomeScreen';
import {VfsDevScreen} from './screens/VfsDevScreen';
import {SkspDevScreen} from './screens/SkspDevScreen';
import {formatVfsError} from './vfs/errors';
import {getVfs} from './vfs/runtime';

type Screen = 'home' | 'vfs' | 'sksp';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [screen, setScreen] = useState<Screen>('home');
  const [vfsReady, setVfsReady] = useState(false);
  const [vfsError, setVfsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVfs()
      .then(() => {
        if (!cancelled) {
          setVfsReady(true);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setVfsError(formatVfsError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View style={styles.root}>
        {screen === 'home' ? (
          <HomeScreen
            onOpenVfs={() => setScreen('vfs')}
            onOpenSksp={() => setScreen('sksp')}
            vfsReady={vfsReady}
            vfsError={vfsError}
          />
        ) : screen === 'vfs' ? (
          <VfsDevScreen onBack={() => setScreen('home')} />
        ) : (
          <SkspDevScreen onBack={() => setScreen('home')} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});

export default App;
