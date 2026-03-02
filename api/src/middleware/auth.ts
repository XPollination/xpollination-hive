import { FastifyRequest, FastifyReply } from "fastify";
import { getDb } from "../services/database.js";

interface UserRow {
  user_id: string;
  display_name: string;
  qdrant_collection: string;
}

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Health endpoint is exempt from auth
  if (request.url.startsWith("/api/v1/health") || request.url === "/health") {
    return;
  }

  const authorization = request.headers.authorization;
  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) {
    reply.code(401).send({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authorization.slice("bearer ".length);
  const db = getDb();
  const user = db.prepare(
    "SELECT user_id, display_name, qdrant_collection FROM users WHERE api_key = ? AND active = 1"
  ).get(token) as UserRow | undefined;

  if (!user) {
    reply.code(401).send({ error: "Invalid API key" });
    return;
  }

  (request as any).user = user;
}
