/** An http address on this machine, the only place a stand-in for a cloud service may live. */
export function isLocalAddress(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
}
