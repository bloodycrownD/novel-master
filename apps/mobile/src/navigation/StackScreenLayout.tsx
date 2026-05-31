/**
 * Stack screen layout with {@link AppHeader} and back navigation.
 */
import React, {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {AppHeader} from '../components/chrome/AppHeader';
import type {HeaderPageKey} from './header-config';

type Props = {
  pageKey: HeaderPageKey;
  children: ReactNode;
};

export function StackScreenLayout({pageKey, children}: Props) {
  const navigation = useNavigation();

  return (
    <View style={styles.root}>
      <AppHeader pageKey={pageKey} onBack={() => navigation.goBack()} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
