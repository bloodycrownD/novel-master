const api = globalThis.novelMasterDesktop;

if (api) {
  document.title = `Novel Master v${api.version}`;
}
