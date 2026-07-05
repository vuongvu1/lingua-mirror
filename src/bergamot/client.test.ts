import { describe, expect, it } from "vitest";
import { fakePortPair } from "../../test/fake-port";
import type { BergamotRequest, PortLike } from "./protocol";
import { bergamotApi } from "./client";

const PAIR = { sourceLanguage: "de", targetLanguage: "en" };

/** Collects server-side messages and lets a test script the responses. */
function harness() {
  const [clientPort, serverPort] = fakePortPair();
  const received: BergamotRequest[] = [];
  serverPort.onMessage.addListener((m) => received.push(m as BergamotRequest));
  return { clientPort, serverPort, received, connect: (): PortLike => clientPort };
}

describe("bergamotApi", () => {
  it("resolves availability from the background's answer", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const promise = api.availability(PAIR);
    expect(h.received[0]).toEqual({ type: "availability", pair: PAIR });
    h.serverPort.postMessage({ type: "availability:result", value: "downloadable" });
    await expect(promise).resolves.toBe("downloadable");
  });

  it("create() sends init and yields a working TranslatorPort", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    expect(h.received[0]).toEqual({ type: "init", pair: PAIR });
    h.serverPort.postMessage({ type: "init:result", ok: true });
    const translator = await portPromise;

    const textPromise = translator.translate("Hallo Welt.");
    const request = h.received[1] as { type: string; id: number; text: string };
    expect(request.type).toBe("translate");
    h.serverPort.postMessage({ type: "translate:result", id: request.id, text: "Hello world." });
    await expect(textPromise).resolves.toBe("Hello world.");
  });

  it("rejects create() when init fails", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    h.serverPort.postMessage({ type: "init:result", ok: false });
    await expect(portPromise).rejects.toThrow();
  });

  it("maps translate:error to a rejection for that id only", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    h.serverPort.postMessage({ type: "init:result", ok: true });
    const translator = await portPromise;

    const bad = translator.translate("kaputt");
    const good = translator.translate("gut");
    const [first, second] = h.received.slice(1) as Array<{ id: number }>;
    h.serverPort.postMessage({ type: "translate:error", id: first!.id, message: "engine burp" });
    h.serverPort.postMessage({ type: "translate:result", id: second!.id, text: "good" });
    await expect(bad).rejects.toThrow("engine burp");
    await expect(good).resolves.toBe("good");
  });

  it("rejects all in-flight translations when the port disconnects", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    h.serverPort.postMessage({ type: "init:result", ok: true });
    const translator = await portPromise;

    const inflight = translator.translate("hängt");
    h.serverPort.disconnect();
    await expect(inflight).rejects.toThrow();
  });

  it("destroy() rejects in-flight translations", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    h.serverPort.postMessage({ type: "init:result", ok: true });
    const translator = await portPromise;
    const inflight = translator.translate("hängt");
    translator.destroy();
    await expect(inflight).rejects.toThrow("translator destroyed");
  });

  it("destroy() disconnects the port", async () => {
    const h = harness();
    let disconnected = false;
    h.clientPort.onDisconnect.addListener(() => {}); // client side
    h.serverPort.onDisconnect.addListener(() => {
      disconnected = true;
    });
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    h.serverPort.postMessage({ type: "init:result", ok: true });
    const translator = await portPromise;
    translator.destroy();
    expect(disconnected).toBe(true);
  });
});
