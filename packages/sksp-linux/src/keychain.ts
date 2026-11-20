/**
 * Linux Secret Service master key storage.
 *
 * 读写流程在 core 的 {@link SkspNodeFactory.createKeyringMasterKey}；这里只注入本平台的
 * service 名、文案素材与钥匙串打开方式。
 *
 * @module keychain
 */

import { SkspNodeFactory } from "@novel-master/core/sksp-node";

const keyringOptions = {
  service: "novel-master-linux",
  label: "Secret Service",
  displayName: "Linux Secret Service (GNOME Keyring / KWallet)",
  platform: "linux",
  open: async (service: string, user: string) => {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry(service, user);
  },
};

const keyring = SkspNodeFactory.createKeyringMasterKey(keyringOptions);

/** Test hook: bypass Secret Service with a fixed in-memory master key. @internal */
export const setLinuxKeychainTestPassthrough = keyring.setTestPassthrough;

/** Returns the 32-byte application master key from Secret Service, creating it on first use. @throws SkspError ENCRYPT_FAILED / DECRYPT_FAILED on failure */
export const getOrCreateMasterKey = keyring.getOrCreate;
