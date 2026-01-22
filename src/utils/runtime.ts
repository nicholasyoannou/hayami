export function getRuntimeUrl(path: string): string {
  const runtime = (globalThis.browser ?? globalThis.chrome)?.runtime;
  if (!runtime?.getURL) return path;
  try {
    return runtime.getURL(path);
  } catch {
    return path;
  }
}
