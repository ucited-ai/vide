import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  hasDeployChanges,
  missingRelayPublicConfigFields,
  publicConfigFromOutput,
  reconcileRootEnvPublicConfig,
  reconcileRootEnvRelayUrl,
  RelayDeployError,
  RelayDeployPublicConfigUnavailableError,
  serializeGithubOutput,
  serializeRelayClientTracingEnvironment,
} from "./deploy.ts";

describe("RelayDeployError", () => {
  it("reports the incomplete state source, stage, and missing fields", () => {
    const missingFields = missingRelayPublicConfigFields({
      url: "https://relay.example.test",
      mobileTracingUrl: "https://api.axiom.co/v1/traces",
    });
    const error = new RelayDeployError({
      source: "alchemy_state",
      stage: "production",
      missingFields,
    });

    expect(error).toMatchObject({
      source: "alchemy_state",
      stage: "production",
      missingFields: [
        "mobileTracingDataset",
        "mobileTracingToken",
        "clientTracingUrl",
        "clientTracingDataset",
        "clientTracingToken",
      ],
    });
    expect(error.message).toBe(
      "Relay deploy output from 'alchemy_state' for stage 'production' is missing required public config fields: mobileTracingDataset, mobileTracingToken, clientTracingUrl, clientTracingDataset, clientTracingToken",
    );
  });

  it("distinguishes deploy results that do not produce public config", () => {
    const error = new RelayDeployPublicConfigUnavailableError({
      result: "dry-run",
      stage: "production",
      outputPath: "/tmp/relay-client.env",
    });

    expect(error.message).toBe(
      "Relay deploy result 'dry-run' for stage 'production' did not produce public config required by GitHub environment output '/tmp/relay-client.env'.",
    );
  });
});

describe("hasDeployChanges", () => {
  it("detects resource, binding, and deletion changes", () => {
    expect(hasDeployChanges({ resources: {}, deletions: {} } as never)).toBe(false);
    expect(
      hasDeployChanges({
        resources: {
          api: { action: "create", bindings: [] },
        },
        deletions: {},
      } as never),
    ).toBe(true);
    expect(
      hasDeployChanges({
        resources: {
          api: { action: "noop", bindings: [{ action: "update" }] },
        },
        deletions: {},
      } as never),
    ).toBe(true);
    expect(
      hasDeployChanges({
        resources: {},
        deletions: {
          api: { action: "delete", bindings: [] },
        },
      } as never),
    ).toBe(true);
  });
});

describe("reconcileRootEnvRelayUrl", () => {
  it("adds the relay URL to an empty root env file", () => {
    expect(reconcileRootEnvRelayUrl("", "https://relay.example.test")).toBe(
      "VIDE_RELAY_URL=https://relay.example.test\n",
    );
  });

  it("preserves unrelated root env entries while replacing a previous relay URL", () => {
    expect(
      reconcileRootEnvRelayUrl(
        "VIDE_CLERK_PUBLISHABLE_KEY=pk_test_example\nVIDE_RELAY_URL=https://old.example.test\n",
        "https://relay.example.test",
      ),
    ).toBe(
      "VIDE_CLERK_PUBLISHABLE_KEY=pk_test_example\nVIDE_RELAY_URL=https://relay.example.test\n",
    );
  });
});

describe("reconcileRootEnvPublicConfig", () => {
  const config = {
    relayUrl: "https://relay.example.test",
    mobileTracingUrl: "https://api.axiom.co/v1/traces",
    mobileTracingDataset: "vide-mobile-traces-dev",
    mobileTracingToken: "xaat-public-ingest",
    clientTracingUrl: "https://api.axiom.co/v1/traces",
    clientTracingDataset: "vide-relay-client-traces-dev",
    clientTracingToken: "xaat-relay-client-ingest",
  } as const;

  it("adds the complete local client config", () => {
    expect(reconcileRootEnvPublicConfig("", config)).toBe(
      [
        "VIDE_RELAY_URL=https://relay.example.test",
        "VIDE_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VIDE_MOBILE_OTLP_TRACES_DATASET=vide-mobile-traces-dev",
        "VIDE_MOBILE_OTLP_TRACES_TOKEN=xaat-public-ingest",
        "VIDE_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VIDE_RELAY_CLIENT_OTLP_TRACES_DATASET=vide-relay-client-traces-dev",
        "VIDE_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-relay-client-ingest",
        "",
      ].join("\n"),
    );
  });

  it("replaces stale values while preserving unrelated entries", () => {
    expect(
      reconcileRootEnvPublicConfig(
        [
          "VIDE_CLERK_PUBLISHABLE_KEY=pk_test_example",
          "VIDE_RELAY_URL=https://old.example.test",
          "VIDE_MOBILE_OTLP_TRACES_URL=https://old.example.test/v1/traces",
          "VIDE_MOBILE_OTLP_TRACES_DATASET=old-dataset",
          "VIDE_MOBILE_OTLP_TRACES_TOKEN=old-token",
          "VIDE_RELAY_CLIENT_OTLP_TRACES_URL=https://old.example.test/v1/traces",
          "VIDE_RELAY_CLIENT_OTLP_TRACES_DATASET=old-client-dataset",
          "VIDE_RELAY_CLIENT_OTLP_TRACES_TOKEN=old-client-token",
          "",
        ].join("\n"),
        config,
      ),
    ).toBe(
      [
        "VIDE_CLERK_PUBLISHABLE_KEY=pk_test_example",
        "VIDE_RELAY_URL=https://relay.example.test",
        "VIDE_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VIDE_MOBILE_OTLP_TRACES_DATASET=vide-mobile-traces-dev",
        "VIDE_MOBILE_OTLP_TRACES_TOKEN=xaat-public-ingest",
        "VIDE_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VIDE_RELAY_CLIENT_OTLP_TRACES_DATASET=vide-relay-client-traces-dev",
        "VIDE_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-relay-client-ingest",
        "",
      ].join("\n"),
    );
  });
});

describe("serializeGithubOutput", () => {
  it("serializes relay deploy metadata for GitHub Actions outputs", () => {
    expect(
      serializeGithubOutput({
        changed: false,
        result: "noop",
        relay_url: "https://relay.example.test",
      }),
    ).toBe("changed=false\nresult=noop\nrelay_url=https://relay.example.test\n");
  });
});

describe("serializeRelayClientTracingEnvironment", () => {
  it("serializes tracing config for downstream GITHUB_ENV loading", () => {
    expect(
      serializeRelayClientTracingEnvironment({
        relayUrl: "https://relay.example.test",
        mobileTracingUrl: "https://api.axiom.co/v1/traces",
        mobileTracingDataset: "mobile",
        mobileTracingToken: "mobile-token",
        clientTracingUrl: "https://api.axiom.co/v1/traces",
        clientTracingDataset: "relay",
        clientTracingToken: "client-token",
      }),
    ).toBe(
      [
        "VIDE_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VIDE_RELAY_CLIENT_OTLP_TRACES_DATASET=relay",
        "VIDE_RELAY_CLIENT_OTLP_TRACES_TOKEN=client-token",
        "",
      ].join("\n"),
    );
  });
});

/*
 * The release-workflow assertions that used to live here are gone with the
 * workflow. This fork removed .github/ entirely — upstream's release pipeline
 * needs secrets, an EAS account and a relay deployment that do not exist here —
 * so a test reading .github/workflows/release.yml could only ever fail. The
 * env-var propagation it guarded is still covered above, at the function that
 * produces those values.
 */

describe("publicConfigFromOutput", () => {
  it("reads the complete public tracing config from persisted Alchemy output", () => {
    expect(
      publicConfigFromOutput({
        url: "https://relay.example.test",
        mobileTracingUrl: "https://api.axiom.co/v1/traces",
        mobileTracingDataset: "mobile",
        mobileTracingToken: "mobile-token",
        clientTracingUrl: "https://api.axiom.co/v1/traces",
        clientTracingDataset: "relay",
        clientTracingToken: "client-token",
      }),
    ).toEqual({
      relayUrl: "https://relay.example.test",
      mobileTracingUrl: "https://api.axiom.co/v1/traces",
      mobileTracingDataset: "mobile",
      mobileTracingToken: "mobile-token",
      clientTracingUrl: "https://api.axiom.co/v1/traces",
      clientTracingDataset: "relay",
      clientTracingToken: "client-token",
    });
  });

  it("rejects incomplete stack output", () => {
    expect(publicConfigFromOutput({ url: "https://relay.example.test" })).toBeNull();
  });
});
