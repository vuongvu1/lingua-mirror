import type { TranslatorApi, TranslatorPort } from "../translator";
import {
  createPendingMap,
  type BergamotResponse,
  type Pair,
  type PortLike,
} from "./protocol";

/**
 * Content-side TranslatorApi backed by the background bergamot engine.
 * availability() uses a short-lived port; create() keeps its port open for
 * the lifetime of the returned TranslatorPort (destroy() disconnects it).
 */
export function bergamotApi(connect: () => PortLike): TranslatorApi {
  return {
    availability(pair: Pair) {
      const port = connect();
      return new Promise((resolve) => {
        port.onMessage.addListener((message) => {
          const response = message as BergamotResponse;
          if (response.type === "availability:result") {
            port.disconnect();
            resolve(response.value);
          }
        });
        port.onDisconnect.addListener(() => resolve("unavailable"));
        port.postMessage({ type: "availability", pair });
      });
    },

    create(pair: Pair): Promise<TranslatorPort> {
      const port = connect();
      const pending = createPendingMap();
      let ready: (translator: TranslatorPort) => void;
      let failed: (error: Error) => void;
      const result = new Promise<TranslatorPort>((resolve, reject) => {
        ready = resolve;
        failed = reject;
      });

      const translator: TranslatorPort = {
        translate(text) {
          const id = pending.next();
          const reply = pending.register(id);
          port.postMessage({ type: "translate", id, text });
          return reply;
        },
        destroy() {
          pending.rejectAll(new Error("translator destroyed"));
          port.disconnect();
        },
      };

      port.onMessage.addListener((message) => {
        const response = message as BergamotResponse;
        switch (response.type) {
          case "init:result":
            if (response.ok) ready(translator);
            else
              failed(
                new Error(
                  `bergamot init failed for ${pair.sourceLanguage}→${pair.targetLanguage}`,
                ),
              );
            break;
          case "translate:result":
            pending.resolve(response.id, response.text);
            break;
          case "translate:error":
            pending.reject(response.id, new Error(response.message));
            break;
        }
      });
      port.onDisconnect.addListener(() => {
        pending.rejectAll(new Error("bergamot port disconnected"));
        failed(new Error("bergamot port disconnected"));
      });

      port.postMessage({ type: "init", pair });
      return result;
    },
  };
}
