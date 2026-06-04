import { vi } from "vitest";

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
  },
  commands: {
    onCommand: { addListener: vi.fn() },
  },
};

// @ts-expect-error - assign a partial mock onto the global for tests
globalThis.chrome = chromeMock;
