export function matchByHost(matchers: RegExp[], location: Location): boolean {
  return matchers.some((m) => m.test(location.hostname));
}
