/**
 * Root shell: runtime bootstrap, theme, and navigation (Chat tab launch).
 */
import React from 'react';
import {StatusBar} from 'react-native';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NovelMasterProvider} from './runtime/novel-master-context';
import {ThemeProvider, useTheme} from './theme/ThemeProvider';
import {ToastHost} from './components/chrome/ToastHost';
import {UpdateCheckHost} from './components/update/UpdateCheckHost';
import {RootNavigator} from './navigation/RootNavigator';

function AppContent() {
  const {mode} = useTheme();

  return (
    <>
      <StatusBar
        barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
      />
      <ToastHost>
        <RootNavigator />
        <UpdateCheckHost />
      </ToastHost>
    </>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider preload={false}>
        <NovelMasterProvider>
          <ThemeProvider>
            <AppContent />
          </ThemeProvider>
        </NovelMasterProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

export default App;
