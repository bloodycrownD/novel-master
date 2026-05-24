/**
 * SKSP runtime: Android driver + secret store singleton.
 */
import type {SecretStore} from '@novel-master/core';
import {createAndroidSecretStore} from '@novel-master/sksp-android';
import {closeMobileConnection, getMobileConnection} from '../db/connection';

let secretStore: SecretStore | undefined;

/** Returns shared {@link SecretStore}, initializing once per process. */
export async function getSecretStore(): Promise<SecretStore> {
  if (secretStore) {
    return secretStore;
  }
  const c = await getMobileConnection();
  secretStore = createAndroidSecretStore(c);
  return secretStore;
}

/** Closes DB and clears singleton. */
export async function closeSecretStore(): Promise<void> {
  secretStore = undefined;
  await closeMobileConnection();
}
