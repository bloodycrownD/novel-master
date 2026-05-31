/**
 * Root shell: runtime bootstrap, theme, and navigation (Chat tab launch).
 */
import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NovelMasterProvider} from './runtime/novel-master-context';
import {ThemeProvider, useTheme} from './theme/ThemeProvider';
import {ToastHost} from './components/chrome/ToastHost';
import {RootNavigator} from './navigation/RootNavigator';

function AppContent() {
  const {mode} = useTheme();

  return (
    <>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <ToastHost>
        <RootNavigator />
      </ToastHost>
    </>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <NovelMasterProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </NovelMasterProvider>
    </SafeAreaProvider>
  );
}

export default App;
