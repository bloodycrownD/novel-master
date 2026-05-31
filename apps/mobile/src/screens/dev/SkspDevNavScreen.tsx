import React from 'react';
import {View, StyleSheet} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {AppHeader} from '../../components/chrome/AppHeader';
import type {RootStackParamList} from '../../navigation/types';
import {SkspDevScreen} from '../SkspDevScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'SkspDev'>;

export function SkspDevNavScreen({navigation}: Props) {
  return (
    <View style={styles.root}>
      <AppHeader pageKey="SkspDev" onBack={() => navigation.goBack()} />
      <SkspDevScreen onBack={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
