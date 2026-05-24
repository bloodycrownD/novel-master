import React, {useState} from 'react';
import {Button, StyleSheet, Text, View} from 'react-native';
import {getSecretStore} from '../sksp/runtime';

const TEST_REF = 'provider/dev-probe/apiKey';

type Props = {
  onBack: () => void;
};

/** Dev probe: set/get SKSP round-trip without printing full secret. */
export function SkspDevScreen({onBack}: Props) {
  const [status, setStatus] = useState<string>('idle');
  const [masked, setMasked] = useState<string>('');

  const runProbe = async () => {
    setStatus('running…');
    setMasked('');
    try {
      const store = await getSecretStore();
      const plain = `probe-${Date.now()}`;
      await store.set(TEST_REF, plain);
      const got = await store.get(TEST_REF);
      if (got !== plain) {
        setStatus('fail: mismatch');
        return;
      }
      const tail = got.slice(-4);
      setMasked(`…${tail} (${got.length} chars)`);
      setStatus('ok');
    } catch (e) {
      setStatus(`fail: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SKSP dev probe</Text>
      <Text style={styles.body}>Ref: {TEST_REF}</Text>
      <Text style={styles.status} testID="sksp-status">
        Status: {status}
      </Text>
      {masked ? <Text style={styles.masked}>Last get: {masked}</Text> : null}
      <Button title="Run set/get" onPress={runProbe} />
      <View style={styles.spacer} />
      <Button title="Back" onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16},
  title: {fontSize: 20, fontWeight: '600', marginBottom: 8},
  body: {fontSize: 14, marginBottom: 12},
  status: {fontSize: 14, marginBottom: 8},
  masked: {fontSize: 14, marginBottom: 16, fontFamily: 'monospace'},
  spacer: {height: 12},
});
