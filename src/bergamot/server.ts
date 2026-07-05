import type { TranslatorAvailability, TranslatorPort } from "../translator";
import type { BergamotRequest, Pair, PortLike } from "./protocol";

/** What the background needs from an engine implementation. */
export type EngineFactory = {
  availability(pair: Pair): Promise<TranslatorAvailability>;
  create(pair: Pair): Promise<TranslatorPort>;
};

/**
 * Serve one content-script connection: answer availability, hold at most one
 * engine per connection, translate by id, tear down on disconnect.
 */
export function handleConnection(port: PortLike, engines: EngineFactory): void {
  let engine: TranslatorPort | null = null;
  let closed = false;

  const send = (message: unknown): void => {
    if (!closed) port.postMessage(message);
  };

  port.onMessage.addListener((message) => {
    const request = message as BergamotRequest;
    switch (request.type) {
      case "availability":
        void engines.availability(request.pair).then(
          (value) => send({ type: "availability:result", value }),
          () => send({ type: "availability:result", value: "unavailable" }),
        );
        break;
      case "init":
        void engines.create(request.pair).then(
          (created) => {
            // ponytail: engine created after disconnect is never destroyed; matters only if destroy() stops being a no-op (see engine.ts note)
            engine = created;
            send({ type: "init:result", ok: true });
          },
          () => send({ type: "init:result", ok: false }),
        );
        break;
      case "translate": {
        if (!engine) {
          send({
            type: "translate:error",
            id: request.id,
            message: "not initialized",
          });
          break;
        }
        void engine.translate(request.text).then(
          (text) => send({ type: "translate:result", id: request.id, text }),
          (error: unknown) =>
            send({
              type: "translate:error",
              id: request.id,
              message: error instanceof Error ? error.message : String(error),
            }),
        );
        break;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    closed = true;
    engine?.destroy();
    engine = null;
  });
}
