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

// In tests, narrow the ambient `chrome.storage.local` get/set to their single
// Promise-returning signatures. `@types/chrome` declares these as overloaded
// functions whose *last* overload is the callback form returning `void`, so
// `ReturnType<typeof chrome.storage.local.get>` is `void`. That makes
// `vi.mocked(chrome.storage.local.get).mockResolvedValue(...)` reject any
// object value. Overriding the type here keeps the runtime mock untouched.
declare global {
  namespace chrome.storage {
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
  }
}
