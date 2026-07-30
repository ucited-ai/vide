import { describe, expect, it } from "vite-plus/test";
import type { ProviderOptionDescriptor } from "@vide/contracts";
import { buildTraitsTriggerDisplay, isScaleDescriptor, splitDescriptorScale } from "./TraitsPicker";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string }>,
  currentValue: string,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return { id, label: id, type: "select", options: [...options], currentValue };
}

function fastModeDescriptor(
  currentValue: boolean,
): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue };
}

const EFFORT = selectDescriptor(
  "effort",
  [
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ],
  "high",
);
const CONTEXT_WINDOW = selectDescriptor(
  "contextWindow",
  [
    { id: "200k", label: "200k" },
    { id: "1m", label: "1M" },
  ],
  "1m",
);

function display(descriptors: ReadonlyArray<ProviderOptionDescriptor>, fastModeEnabled: boolean) {
  return buildTraitsTriggerDisplay({
    descriptors,
    primarySelectDescriptorId: "effort",
    ultrathinkPromptControlled: false,
    fastModeEnabled,
  });
}

describe("buildTraitsTriggerDisplay", () => {
  it("omits fast mode from the label entirely when it is off", () => {
    expect(display([EFFORT, fastModeDescriptor(false), CONTEXT_WINDOW], false)).toEqual({
      label: "High · 1M",
      showFastModeIcon: false,
    });
  });

  it("shows the bolt instead of a text label when fast mode is on", () => {
    expect(display([EFFORT, fastModeDescriptor(true), CONTEXT_WINDOW], true)).toEqual({
      label: "High · 1M",
      showFastModeIcon: true,
    });
  });

  it("keeps non-fastMode booleans as text labels", () => {
    const thinking: Extract<ProviderOptionDescriptor, { type: "boolean" }> = {
      id: "thinking",
      label: "Thinking",
      type: "boolean",
      currentValue: true,
    };
    expect(display([EFFORT, thinking], false)).toEqual({
      label: "High · Thinking On",
      showFastModeIcon: false,
    });
  });

  it("falls back to a text label when fast mode is the only trait", () => {
    expect(display([fastModeDescriptor(true)], true)).toEqual({
      label: "Fast",
      showFastModeIcon: false,
    });
    expect(display([fastModeDescriptor(false)], false)).toEqual({
      label: "Normal",
      showFastModeIcon: false,
    });
  });

  it("stays blank when descriptors resolve to no label and there is no fast mode", () => {
    // A select with neither a currentValue nor an isDefault option yields no
    // label. Without a fastMode descriptor present that must stay blank rather
    // than falling through to a bogus "Normal".
    const unresolved: Extract<ProviderOptionDescriptor, { type: "select" }> = {
      id: "effort",
      label: "effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    };
    expect(display([unresolved], false)).toEqual({ label: "", showFastModeIcon: false });
  });

  it("still renders the prompt-controlled ultrathink label alongside the bolt", () => {
    expect(
      buildTraitsTriggerDisplay({
        descriptors: [EFFORT, fastModeDescriptor(true)],
        primarySelectDescriptorId: "effort",
        ultrathinkPromptControlled: true,
        fastModeEnabled: true,
      }),
    ).toEqual({ label: "Ultrathink", showFastModeIcon: true });
  });
});

// Which control a select descriptor earns. A slider says "more of this", so it
// is only correct for a registered scale with somewhere to travel; everything
// else keeps the button row.
describe("select descriptor control mapping", () => {
  const claudeEffort: Extract<ProviderOptionDescriptor, { type: "select" }> = {
    id: "effort",
    label: "Reasoning",
    type: "select",
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High", isDefault: true },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
      { id: "ultracode", label: "Ultracode" },
      { id: "ultrathink", label: "Ultrathink" },
    ],
    currentValue: "high",
    promptInjectedValues: ["ultrathink"],
  };

  it("keeps prompt-injected options off the scale but does not drop them", () => {
    const scale = splitDescriptorScale(claudeEffort);

    expect(scale.stops.map((stop) => stop.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
    ]);
    expect(scale.promptInjected.map((option) => option.id)).toEqual(["ultrathink"]);
    expect(isScaleDescriptor(claudeEffort, scale)).toBe(true);
  });

  it("refuses a slider for a two-option ordered descriptor", () => {
    expect(isScaleDescriptor(CONTEXT_WINDOW, splitDescriptorScale(CONTEXT_WINDOW))).toBe(false);
  });

  it("refuses a slider for named alternatives however many there are", () => {
    const agent = selectDescriptor(
      "agent",
      [
        { id: "build", label: "Build" },
        { id: "plan", label: "Plan" },
        { id: "general", label: "General" },
      ],
      "build",
    );

    expect(isScaleDescriptor(agent, splitDescriptorScale(agent))).toBe(false);
  });

  it("counts stops after removing prompt-injected options", () => {
    // A registered scale whose only travel comes from an option the prompt
    // owns is a two-stop slider, which is a worse switch.
    const thin: Extract<ProviderOptionDescriptor, { type: "select" }> = {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "high", label: "High", isDefault: true },
        { id: "max", label: "Max" },
        { id: "ultrathink", label: "Ultrathink" },
      ],
      currentValue: "high",
      promptInjectedValues: ["ultrathink"],
    };

    expect(isScaleDescriptor(thin, splitDescriptorScale(thin))).toBe(false);
  });
});
