import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import { makeOpenCode2ModelLoader, type OpenCode2Model } from "./status.ts";

const bigPickle: OpenCode2Model = {
  providerID: "opencode",
  id: "big-pickle",
  name: "Big Pickle",
  variants: [],
};

it.effect("waits for a fresh OpenCode 2 server to list its models", () =>
  Effect.gen(function* () {
    const replies: Array<ReadonlyArray<OpenCode2Model>> = [[], [], [bigPickle]];
    const load = yield* makeOpenCode2ModelLoader(Effect.sync(() => replies.shift() ?? [bigPickle]));
    const fiber = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("1 second");
    NodeAssert.deepEqual(yield* Fiber.join(fiber), [bigPickle]);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("keeps the last OpenCode 2 model list while a fresh server's stays empty", () =>
  Effect.gen(function* () {
    let listed: ReadonlyArray<OpenCode2Model> = [bigPickle];
    const load = yield* makeOpenCode2ModelLoader(Effect.sync(() => listed));
    const first = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("1 second");
    NodeAssert.deepEqual(yield* Fiber.join(first), [bigPickle]);
    listed = [];
    const fiber = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("61 seconds");
    NodeAssert.deepEqual(yield* Fiber.join(fiber), [bigPickle]);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("waits for a slow OpenCode 2 cold start before listing models", () =>
  Effect.gen(function* () {
    let cold = true;
    const load = yield* makeOpenCode2ModelLoader(
      Effect.gen(function* () {
        if (cold) {
          cold = false;
          yield* Effect.sleep("45 seconds");
        }
        return [bigPickle];
      }),
    );
    const fiber = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("6 seconds");
    NodeAssert.equal(fiber.pollUnsafe(), undefined);
    yield* TestClock.adjust("40 seconds");
    NodeAssert.deepEqual(yield* Fiber.join(fiber), [bigPickle]);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("waits for a growing OpenCode 2 catalog to settle before caching it", () =>
  Effect.gen(function* () {
    const first: OpenCode2Model = {
      providerID: "opencode",
      id: "first",
      name: "First",
      variants: [],
    };
    const second: OpenCode2Model = {
      providerID: "opencode",
      id: "second",
      name: "Second",
      variants: [],
    };
    const replies: Array<ReadonlyArray<OpenCode2Model>> = [
      [first],
      [first, second],
      [first, second],
    ];
    const load = yield* makeOpenCode2ModelLoader(
      Effect.sync(() => replies.shift() ?? [first, second]),
    );
    const fiber = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("1 second");
    NodeAssert.ok(fiber.pollUnsafe(), "A settled catalog should finish before the load deadline");
    NodeAssert.deepEqual(yield* Fiber.join(fiber), [first, second]);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("waits for OpenCode 2 model names, provider labels, and variants to settle", () =>
  Effect.gen(function* () {
    const renamed = { ...bigPickle, name: "Bigger Pickle" };
    const labeled = { ...renamed, providerName: "OpenCode Zen" };
    const withVariants = { ...labeled, variants: [{ id: "low" }] };
    const complete = { ...labeled, variants: [{ id: "high" }, { id: "medium" }] };
    const reordered = { ...complete, variants: [{ id: "medium" }, { id: "high" }] };
    const replies = [[bigPickle], [renamed], [labeled], [withVariants], [complete], [reordered]];
    const load = yield* makeOpenCode2ModelLoader(Effect.sync(() => replies.shift() ?? [complete]));
    const fiber = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("1500 millis");
    NodeAssert.ok(
      fiber.pollUnsafe(),
      "Equivalent variant orders should settle before the deadline",
    );
    NodeAssert.deepEqual(yield* Fiber.join(fiber), [reordered]);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("bounds an unsettled OpenCode 2 catalog and keeps its latest nonempty observation", () =>
  Effect.gen(function* () {
    let reads = 0;
    let latest: ReadonlyArray<OpenCode2Model> = [];
    const changing = () => {
      latest = [{ ...bigPickle, name: `Pickle ${++reads}` }];
      return latest;
    };
    let list = changing;
    const load = yield* makeOpenCode2ModelLoader(Effect.sync(() => list()));
    const cold = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("60 seconds");
    NodeAssert.ok(cold.pollUnsafe());
    NodeAssert.ok(reads > 1);
    NodeAssert.deepEqual(yield* Fiber.join(cold), latest);

    list = () => [];
    const empty = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("60 seconds");
    NodeAssert.ok(empty.pollUnsafe());
    NodeAssert.deepEqual(yield* Fiber.join(empty), latest);

    list = () => [bigPickle];
    const settled = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("1 second");
    NodeAssert.deepEqual(yield* Fiber.join(settled), [bigPickle]);

    reads = 0;
    list = () => (reads++ === 0 ? [bigPickle] : changing());
    const fresh = yield* load.pipe(Effect.forkChild);
    yield* TestClock.adjust("60 seconds");
    NodeAssert.ok(fresh.pollUnsafe());
    NodeAssert.ok(reads > 1);
    NodeAssert.deepEqual(yield* Fiber.join(fresh), latest);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect(
  "refreshes a warm OpenCode 2 catalog when slow reads cannot settle before the deadline",
  () =>
    Effect.gen(function* () {
      let listed: ReadonlyArray<OpenCode2Model> = [bigPickle];
      let slow = false;
      const load = yield* makeOpenCode2ModelLoader(
        Effect.gen(function* () {
          if (slow) yield* Effect.sleep("31 seconds");
          return listed;
        }),
      );
      const warm = yield* load.pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      NodeAssert.deepEqual(yield* Fiber.join(warm), [bigPickle]);

      listed = [{ ...bigPickle, name: "Fresh Pickle" }];
      slow = true;
      const fresh = yield* load.pipe(Effect.forkChild);
      yield* TestClock.adjust("60 seconds");
      NodeAssert.ok(fresh.pollUnsafe());
      NodeAssert.deepEqual(yield* Fiber.join(fresh), listed);
    }).pipe(Effect.provide(TestClock.layer())),
);

it.effect(
  "keeps a fresh OpenCode 2 observation if confirmation fails but propagates an initial failure",
  () =>
    Effect.gen(function* () {
      const error = new OpenCodeRuntime.OpenCodeRuntimeError({
        operation: "model.list",
        detail: "Model list failed",
      });
      let reads = 0;
      const load = yield* makeOpenCode2ModelLoader(
        Effect.suspend(() => (reads++ === 0 ? Effect.succeed([bigPickle]) : Effect.fail(error))),
      );
      const fresh = yield* load.pipe(Effect.forkChild);
      yield* TestClock.adjust("250 millis");
      NodeAssert.deepEqual(yield* Fiber.join(fresh), [bigPickle]);
      NodeAssert.equal(yield* load.pipe(Effect.flip), error);
    }).pipe(Effect.provide(TestClock.layer())),
);
