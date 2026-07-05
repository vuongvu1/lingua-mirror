import type { PortLike } from "../src/bergamot/protocol";

/**
 * Two linked in-memory ports: messages posted on one side arrive on the
 * other synchronously; disconnect() fires the peer's onDisconnect.
 */
export function fakePortPair(): [PortLike, PortLike] {
  const listeners: [Array<(m: unknown) => void>, Array<() => void>][] = [
    [[], []],
    [[], []],
  ];
  let connected = true;
  const make = (self: 0 | 1, peer: 0 | 1): PortLike => ({
    postMessage(message) {
      if (!connected) return;
      for (const cb of listeners[peer]![0]) cb(message);
    },
    disconnect() {
      if (!connected) return;
      connected = false;
      for (const cb of listeners[peer]![1]) cb();
    },
    onMessage: { addListener: (cb) => listeners[self]![0].push(cb) },
    onDisconnect: { addListener: (cb) => listeners[self]![1].push(cb) },
  });
  return [make(0, 1), make(1, 0)];
}
