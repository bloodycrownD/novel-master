/** RN/Hermes provide base64 helpers on globalThis at runtime. */
interface GlobalBase64 {
  atob(data: string): string;
  btoa(data: string): string;
}

declare global {
  // eslint-disable-next-line no-var
  var atob: GlobalBase64['atob'];
  // eslint-disable-next-line no-var
  var btoa: GlobalBase64['btoa'];
}

export {};
