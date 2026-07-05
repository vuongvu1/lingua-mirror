import { describe, expect, it, vi } from "vitest";
import { fakePortPair } from "../../test/fake-port";
import type { BergamotResponse } from "./protocol";
import { handleConnection, type EngineFactory } from "./server";

const PAIR = { sourceLanguage: "de", targetLanguage: "en" };

function collect(port: ReturnType<typeof fakePortPair>[0]): BergamotResponse[] {
  const out: BergamotResponse[] = [];
  port.onMessage.addListener((m) => out.push(m as BergamotResponse));
  return out;
}

function mockEngines(overrides: Partial<EngineFactory> = {}): EngineFactory {
  return {
    availability: vi.fn().mockResolvedValue("downloadable"),
    create: vi.fn().mockResolvedValue({
      translate: vi.fn(async (text: string) => text.toUpperCase()),
      destroy: vi.fn(),
    }),
    ...overrides,
  };
}

describe("handleConnection", () => {
  it("answers availability requests", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    handleConnection(server, mockEngines());
    client.postMessage({ type: "availability", pair: PAIR });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({
        type: "availability:result",
        value: "downloadable",
      }),
    );
  });

  it("init creates an engine and confirms", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    const engines = mockEngines();
    handleConnection(server, engines);
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({ type: "init:result", ok: true }),
    );
    expect(engines.create).toHaveBeenCalledWith(PAIR);
  });

  it("init failure reports ok:false", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    handleConnection(
      server,
      mockEngines({ create: vi.fn().mockRejectedValue(new Error("no model")) }),
    );
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({ type: "init:result", ok: false }),
    );
  });

  it("translates after init, echoing the request id", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    handleConnection(server, mockEngines());
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() => expect(responses.length).toBe(1));
    client.postMessage({ type: "translate", id: 7, text: "hallo" });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({
        type: "translate:result",
        id: 7,
        text: "HALLO",
      }),
    );
  });

  it("maps a translate crash to translate:error with the same id", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    const engines = mockEngines({
      create: vi.fn().mockResolvedValue({
        translate: vi.fn().mockRejectedValue(new Error("wasm panic")),
        destroy: vi.fn(),
      }),
    });
    handleConnection(server, engines);
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() => expect(responses.length).toBe(1));
    client.postMessage({ type: "translate", id: 3, text: "x" });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({
        type: "translate:error",
        id: 3,
        message: "wasm panic",
      }),
    );
  });

  it("translate before init errors instead of crashing", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    handleConnection(server, mockEngines());
    client.postMessage({ type: "translate", id: 1, text: "premature" });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({
        type: "translate:error",
        id: 1,
        message: "not initialized",
      }),
    );
  });

  it("destroys the engine on disconnect", async () => {
    const [client, server] = fakePortPair();
    const destroy = vi.fn();
    const engines = mockEngines({
      create: vi.fn().mockResolvedValue({ translate: vi.fn(), destroy }),
    });
    const responses = collect(client);
    handleConnection(server, engines);
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() => expect(responses.length).toBe(1));
    client.disconnect();
    expect(destroy).toHaveBeenCalled();
  });
});
