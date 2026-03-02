process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
});

import Fastify from "fastify";
import cors from "@fastify/cors";
import { ensureCollections } from "./services/vectordb.js";
import { ensureThoughtSpace, startPheromoneDecayJob } from "./services/thoughtspace.js";
import { getDb } from "./services/database.js";
import { queryRoutes } from "./routes/query.js";
import { ingestRoutes } from "./routes/ingest.js";
import { healthRoutes } from "./routes/health.js";
import { memoryRoutes } from "./routes/memory.js";
import { startMcpServer } from "./mcp/brain-mcp.js";
import { authHook } from "./middleware/auth.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.addHook("onRequest", authHook);

await app.register(queryRoutes);
await app.register(ingestRoutes);
await app.register(healthRoutes);
await app.register(memoryRoutes);

try {
  await ensureCollections();
  await ensureThoughtSpace();
  getDb(); // Initialize SQLite query_log table
  startPheromoneDecayJob();
  console.log("Qdrant collections ready. SQLite query_log ready. Decay job started.");
} catch (err) {
  console.error("Failed to initialize:", err);
  process.exit(1);
}

await app.listen({ port: 3200, host: "0.0.0.0" });
console.log("API server running on http://0.0.0.0:3200");
await startMcpServer();
