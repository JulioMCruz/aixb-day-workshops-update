import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stageCapabilities } from "./config.js";
import { registerAgentRoutes } from "./routes/agent.js";
// w04-update: ERC-8004 identity routes (see routes/agents.ts).
import { registerAgentIdentityRoutes } from "./routes/agents.js";
import { registerBrainRoutes } from "./routes/brain.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerMentorAgentRoutes } from "./routes/mentor-agent.js";
import { registerMentorRoutes } from "./routes/mentor.js";
import { registerWebRoutes } from "./routes/web.js";
import { registerX402PayRoute } from "./routes/x402-pay.js";
import type { AppConfig } from "./types.js";

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({
      ok: true,
      service: "aixb-day-server",
      event: "AI x Blockchain Day",
      framework: "hono",
      integration: "live",
      workshopStage: config.stage,
      capabilities: stageCapabilities(config)
    });
  });

  app.get("/x402-client.js", async (c) => {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const candidate = join(here, "..", "public", "x402-client.js");
      const source = await readFile(candidate, "utf8");
      return new Response(source, {
        status: 200,
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-cache"
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return c.json({ error: "x402-client.js not built", details: message }, 500);
    }
  });

  registerWebRoutes(app, config);
  registerBrainRoutes(app, config);
  registerAgentRoutes(app, config);
  registerMentorAgentRoutes(app, config);
  registerMentorRoutes(app, config);
  registerJobRoutes(app, config);
  registerAgentIdentityRoutes(app, config);
  registerX402PayRoute(app, config);

  return app;
}
