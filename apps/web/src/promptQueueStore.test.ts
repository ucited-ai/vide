import { beforeEach, describe, expect, it } from "vite-plus/test";

import { type QueuedPromptEntry, selectThreadQueue, usePromptQueueStore } from "./promptQueueStore";

const THREAD = "env:thread-1";

function entry(id: string): QueuedPromptEntry {
  return { id, prompt: `prompt ${id}`, images: [], queuedAt: "2026-08-02T00:00:00.000Z" };
}

describe("promptQueueStore", () => {
  beforeEach(() => {
    usePromptQueueStore.setState({ queuesByThreadKey: {}, dispatchHoldByThreadKey: {} });
  });

  it("enqueues in order and takes from the front", () => {
    const store = usePromptQueueStore.getState();
    store.enqueue(THREAD, entry("a"));
    store.enqueue(THREAD, entry("b"));
    expect(usePromptQueueStore.getState().takeFirst(THREAD)?.id).toBe("a");
    expect(usePromptQueueStore.getState().takeFirst(THREAD)?.id).toBe("b");
    expect(usePromptQueueStore.getState().takeFirst(THREAD)).toBeNull();
  });

  it("requeueFront puts a failed dispatch back at the head and holds it", () => {
    const store = usePromptQueueStore.getState();
    store.enqueue(THREAD, entry("a"));
    store.enqueue(THREAD, entry("b"));
    const taken = usePromptQueueStore.getState().takeFirst(THREAD)!;
    usePromptQueueStore.getState().requeueFront(THREAD, taken);
    const state = usePromptQueueStore.getState();
    expect(selectThreadQueue(state, THREAD).map((queued) => queued.id)).toEqual(["a", "b"]);
    expect(state.dispatchHoldByThreadKey[THREAD]).toBe("a");
  });

  it("any queue mutation lifts the dispatch hold", () => {
    const store = usePromptQueueStore.getState();
    store.enqueue(THREAD, entry("a"));
    const taken = usePromptQueueStore.getState().takeFirst(THREAD)!;
    usePromptQueueStore.getState().requeueFront(THREAD, taken);
    usePromptQueueStore.getState().enqueue(THREAD, entry("b"));
    expect(usePromptQueueStore.getState().dispatchHoldByThreadKey[THREAD]).toBeUndefined();

    usePromptQueueStore.getState().requeueFront(THREAD, entry("held"));
    usePromptQueueStore.getState().removeEntry(THREAD, "held");
    expect(usePromptQueueStore.getState().dispatchHoldByThreadKey[THREAD]).toBeUndefined();
  });

  it("removeEntry returns the removed entry and leaves other threads alone", () => {
    const store = usePromptQueueStore.getState();
    store.enqueue(THREAD, entry("a"));
    store.enqueue("env:other", entry("x"));
    const removed = usePromptQueueStore.getState().removeEntry(THREAD, "a");
    expect(removed?.id).toBe("a");
    expect(usePromptQueueStore.getState().removeEntry(THREAD, "a")).toBeNull();
    const state = usePromptQueueStore.getState();
    expect(selectThreadQueue(state, THREAD)).toHaveLength(0);
    expect(selectThreadQueue(state, "env:other").map((queued) => queued.id)).toEqual(["x"]);
  });

  it("selectThreadQueue answers a missing thread with a stable empty queue", () => {
    const state = usePromptQueueStore.getState();
    expect(selectThreadQueue(state, "env:none")).toBe(selectThreadQueue(state, null));
  });
});
