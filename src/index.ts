import { Plugin } from "@opencode/plugin";
import { Media } from "./rpc.js";

/**
 * The reachable half of the panel.
 *
 * A TUI plugin cannot be called from outside its process, but a server plugin
 * can: `POST /api/rpc/media/open` (or `client.rpc(Media).open(...)`) lands here.
 * Each call is forwarded as an event, and every subscribed TUI opens the panel
 * from it. The server part holds no panel state on purpose, so restarting the
 * TUI needs no re-registration.
 */
export default Plugin.define({
  id: "media.panel.server",
  async setup(context) {
    const registration = await context.rpc.register(Media, {
      open: async (input) => {
        const source =
          typeof input === "object" && input !== null
            ? (input as { source?: unknown }).source
            : undefined;
        if (typeof source !== "string" || source.trim() === "") {
          throw new Error("A source path is required");
        }
        await registration.events.emit("open", { source });
        return { queued: true };
      },
    });
  },
});
