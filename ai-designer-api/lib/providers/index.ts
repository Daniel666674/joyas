import type { Config } from "../config";
import { createMeshyProvider } from "./meshy";
import { createMockProvider } from "./mock";
import type { ModelProvider } from "./types";

/** The one place that turns the PROVIDER setting into a working provider. */
export function createProvider(config: Config, fetchImpl: typeof fetch = fetch): ModelProvider {
  switch (config.provider) {
    case "meshy":
      return createMeshyProvider(config.meshy, fetchImpl);
    case "mock":
      return createMockProvider(config.mock);
  }
}

export type { ModelProvider } from "./types";
