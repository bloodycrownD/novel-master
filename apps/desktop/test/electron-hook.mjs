const stubUrl = new URL("./electron-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") {
    return {
      shortCircuit: true,
      url: stubUrl,
    };
  }
  return nextResolve(specifier, context);
}
