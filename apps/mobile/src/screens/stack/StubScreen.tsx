/**
 * Minimal stack screen placeholder for M1 route registration.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {title: string};

export function StubScreen({title}: Props) {
  const {tokens} = useTheme();
  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <Text style={{color: tokens.text}}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, justifyContent: 'center', alignItems: 'center'},
});
