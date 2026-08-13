import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Provider-native attribution for work emitted by a delegated agent. */
export const ProviderAgentAttribution = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
  parentToolUseId: Schema.optional(TrimmedNonEmptyString),
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
  path: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderAgentAttribution = typeof ProviderAgentAttribution.Type;
