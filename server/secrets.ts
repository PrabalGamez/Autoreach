import { Entry } from '@napi-rs/keyring';

const SERVICE = 'autoreach';
const memory = new Map<string, string>();
const useMemory = () => process.env.AUTOREACH_SECRETS === 'memory';

export type SecretKey = 'google_client_id' | 'google_client_secret' | 'google_refresh_token';

/** Secrets live in the OS keychain (macOS Keychain, Windows Credential Manager, libsecret). */
export function getSecret(key: SecretKey): string | null {
  if (useMemory()) return memory.get(key) ?? null;
  try {
    return new Entry(SERVICE, key).getPassword() ?? null;
  } catch {
    return null;
  }
}

export function setSecret(key: SecretKey, value: string) {
  if (useMemory()) return void memory.set(key, value);
  new Entry(SERVICE, key).setPassword(value);
}

export function deleteSecret(key: SecretKey) {
  if (useMemory()) return void memory.delete(key);
  try {
    new Entry(SERVICE, key).deletePassword();
  } catch {
    /* already gone */
  }
}

export function deleteAllSecrets() {
  for (const k of ['google_client_id', 'google_client_secret', 'google_refresh_token'] as SecretKey[]) deleteSecret(k);
}
