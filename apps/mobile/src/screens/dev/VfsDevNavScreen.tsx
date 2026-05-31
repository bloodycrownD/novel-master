import React from 'react';
import {View, StyleSheet} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {AppHeader} from '../../components/chrome/AppHeader';
import type {RootStackParamList} from '../../navigation/types';
import {VfsDevScreen} from '../VfsDevScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'VfsDev'>;

export function VfsDevNavScreen({navigation}: Props) {
  return (
    <View style={styles.root}>
      <AppHeader pageKey="VfsDev" onBack={() => navigation.goBack()} />
      <VfsDevScreen onBack={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
