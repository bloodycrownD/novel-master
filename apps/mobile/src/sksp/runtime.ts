/**
 * SKSP runtime: Android driver + secret store singleton.
 */
import {
  bootstrapNovelMaster,
  open,
  type SecretStore,
  type TdbcConnection,
} from '@novel-master/core';
import {registerRnDriver} from '@novel-master/tdbc-driver-rn/native';
import {
  createAndroidSecretStore,
  registerSkspAndroidDriver,
} from '@novel-master/sksp-android';
import {MOBILE_TDBC_URL} from '../vfs/constants';

let conn: TdbcConnection | undefined;
let secretStore: SecretStore | undefined;
let initPromise: Promise<SecretStore> | undefined;

/** Returns shared {@link SecretStore}, initializing once per process. */
export async function getSecretStore(): Promise<SecretStore> {
  if (secretStore) {
    return secretStore;
  }
  if (!initPromise) {
    initPromise = (async () => {
      registerRnDriver();
      registerSkspAndroidDriver();
      const c = await open(MOBILE_TDBC_URL, {driver: 'rn'});
      await bootstrapNovelMaster(c);
      conn = c;
      secretStore = createAndroidSecretStore(c);
      return secretStore;
    })();
  }
  return initPromise;
}

/** Closes DB and clears singleton. */
export async function closeSecretStore(): Promise<void> {
  await conn?.close();
  conn = undefined;
  secretStore = undefined;
  initPromise = undefined;
}
