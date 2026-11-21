import { Rpc } from "@opencode/plugin/rpc";

/**
 * Contract between the server part, the TUI part, and any external caller.
 *
 * The panel lives in the TUI process, which no client can reach directly. The
 * server part is the reachable side: a method call emits an event that every
 * subscribed TUI opens from. Both are stateless, so a TUI that was not running
 * when the call happened simply misses it, which is the same as typing the
 * command late.
 *
 * Schemas are JSON Schema so the definition stays portable across the server,
 * the TUI, and an HTTP caller that only knows the shapes. `Rpc.define` infers
 * the non-portable union in this version, so the definition is narrowed once
 * here instead of at every call site.
 */
const definition = Rpc.define({
  id: "media",
  methods: {
    open: {
      input: {
        type: "object",
        properties: { source: { type: "string" } },
        required: ["source"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { queued: { type: "boolean" } },
        required: ["queued"],
        additionalProperties: false,
      },
    },
  },
  events: {
    open: {
      schema: {
        type: "object",
        properties: { source: { type: "string" } },
        required: ["source"],
        additionalProperties: false,
      },
    },
  },
});

export const Media = definition as unknown as Rpc.PortableDefinition;
