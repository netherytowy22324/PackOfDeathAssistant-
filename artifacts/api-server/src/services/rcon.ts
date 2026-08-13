import { Rcon } from "rcon-client";
import { logger } from "../lib/logger.js";
import { logEvent } from "./system-log.js";

const MC_HOST = process.env["MC_HOST"] ?? "localhost";
const RCON_PORT = parseInt(process.env["RCON_PORT"] ?? "25575", 10);
const RCON_PASSWORD = process.env["RCON_PASSWORD"] ?? "";

let rcon: Rcon | null = null;
let isConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastConnectAttempt = 0;

export async function connectRcon(): Promise<void> {
  if (isConnected && rcon) return;

  // Throttle reconnect attempts
  const now = Date.now();
  if (now - lastConnectAttempt < 5000) return;
  lastConnectAttempt = now;

  try {
    if (rcon) {
      try { rcon.end(); } catch { /* ignore */ }
    }

    rcon = new Rcon({ host: MC_HOST, port: RCON_PORT, password: RCON_PASSWORD });
    await rcon.connect();
    isConnected = true;

    logger.info({ host: MC_HOST, port: RCON_PORT }, "RCON connected");
    await logEvent("info", "rcon", "Połączono z RCON");

    rcon.on("end", () => {
      isConnected = false;
      rcon = null;
      logger.warn("RCON disconnected, will reconnect");
      scheduleReconnect();
    });

    rcon.on("error", (err) => {
      isConnected = false;
      logger.error({ err: String(err) }, "RCON error");
      scheduleReconnect();
    });
  } catch (err) {
    isConnected = false;
    rcon = null;
    logger.warn({ err: String(err) }, "RCON connection failed, will retry");
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectRcon().catch(() => {});
  }, 10000);
}

export async function sendRconCommand(command: string): Promise<string | null> {
  if (!isConnected || !rcon) {
    logger.warn("RCON not connected, attempting reconnect");
    await connectRcon();
    if (!isConnected || !rcon) return null;
  }

  try {
    const result = await rcon.send(command);
    return result;
  } catch (err) {
    logger.error({ err: String(err) }, "RCON command failed");
    isConnected = false;
    scheduleReconnect();
    return null;
  }
}

/**
 * Send a chat message to Minecraft as the server.
 * Uses /say [DC] Nick: message format.
 */
export async function sendToMinecraft(display: string, message: string): Promise<boolean> {
  const formatted = `[DC] ${display}: ${message}`;
  const result = await sendRconCommand(`say ${formatted}`);
  return result !== null;
}

export function getRconStatus(): { connected: boolean; host: string; port: number } {
  return { connected: isConnected, host: MC_HOST, port: RCON_PORT };
}

export async function disconnectRcon(): Promise<void> {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (rcon) {
    try { rcon.end(); } catch { /* ignore */ }
    rcon = null;
  }
  isConnected = false;
}
