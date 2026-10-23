import { it, assert } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as ProviderRegistry from "./ProviderRegistry.ts";

it.each([
  { status: "ready" as const, descriptors: [], retain: false },
  { status: "error" as const, descriptors: [], retain: true },
  { status: "ready" as const, descriptors: undefined, retain: true },
])(
  "handles empty OpenCode options after a $status refresh with descriptors $descriptors",
  ({ status, descriptors, retain }) => {
    const capabilities = createModelCapabilities({
      optionDescriptors: [
        {
          id: "variant",
          label: "Reasoning",
          type: "select",
          options: [{ id: "medium", label: "Medium", isDefault: true }],
          currentValue: "medium",
        },
      ],
    });
    const previousProvider = {
      instanceId: ProviderInstanceId.make("opencode"),
      driver: ProviderDriverKind.make("opencode"),
      status: "ready",
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      checkedAt: "2026-07-17T00:00:00.000Z",
      version: "2.0.31",
      slashCommands: [],
      skills: [],
      models: ["big-pickle", "mimo-v2.6-flash-free", "nemotron-3-ultra-free"].map((id) => ({
        slug: `opencode/${id}`,
        name: id,
        isCustom: false,
        capabilities,
      })),
    } as const satisfies ServerProvider;
    const refreshedProvider = {
      ...previousProvider,
      status,
      version: "2.1.2",
      checkedAt: "2026-07-17T00:01:00.000Z",
      models: previousProvider.models.map((model) => ({
        ...model,
        capabilities: descriptors === undefined ? null : { optionDescriptors: descriptors },
      })),
    } satisfies ServerProvider;

    assert.deepStrictEqual(
      ProviderRegistry.mergeProviderSnapshot(previousProvider, refreshedProvider).models,
      retain
        ? refreshedProvider.models.map((model) => ({ ...model, capabilities }))
        : refreshedProvider.models,
    );
  },
);
