import path from "node:path";
import { fileURLToPath } from "node:url";

export const DAEMON_HOST = "127.0.0.1";
export const DAEMON_PORT = 47321;
export const DAEMON_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`;

export function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function workflowsDir(): string {
  return path.join(projectRoot(), "workflows");
}
