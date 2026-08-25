import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import { logger } from "../lib/logger.js";
import { bridgeService } from "./bridge.js";
import { verifyCode, getVerificationStatusByMcNick } from "./verification.js";
import { sendPrivateMessage, getPendingMessagesForMcNick, getPendingMessagesForDiscordId, markMessagesDelivered } from "./privmsg.js";
import { logChat, logEvent } from "./system-log.js";
import type { Client as DiscordClient } from "discord.js";

const MC_HOST = process.env["MC_HOST"] ?? "localhost";
const MC_PORT = parseInt(process.env["MC_PORT"] ?? "25565", 10);
const MC_BOT_NICK = process.env["MC_BOT_NICK"] ?? "SyncBot";
const MC_MODE = process.env["MC_MODE"] ?? "offline";
const MC_BOT_PASSWORD = process.env["MC_BOT_PASSWORD"] ?? "";

let bot: Bot | null = null;
let isConnected = false;
let isConnecting = false; // true while connecting OR waiting to reconnect — prevents double connects
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 5000; // exponential backoff: starts at 5s, doubles up to 60s
let antiAfkTimer: ReturnType<typeof setInterval> | null = null;
let discordClientRef: DiscordClient | null = null;
let chatChannelId: string | null = null;
let chatChannelRef: any = null;
let loginSent = false;
let spawnCount = 0;
let botGeneration = 0;

function startAntiAfk(): void {
  if (antiAfkTimer) clearInterval(antiAfkTimer);
  antiAfkTimer = setInterval(() => {
    if (!bot || !isConnected) return;
    try {
      // Swing arm to stay "active" — invisible to players, prevents AFK kick
      bot.swingArm(undefined);
    } catch { /* ignore */ }
  }, 90_000); // every 90 seconds
}

function stopAntiAfk(): void {
  if (antiAfkTimer) {
    clearInterval(antiAfkTimer);
    antiAfkTimer = null;
  }
}

export function setDiscordRef(client: DiscordClient, channelId: string): void {
  discordClientRef = client;
  chatChannelId = channelId;
  chatChannelRef = null;
}

export function connectMinecraft(): void {
  if (process.env["MC_BOT_ENABLED"] !== "true") return; // disabled in this environment
  if (isConnected || isConnecting || reconnectTimer) return; // already up or a reconnect is pending

  isConnecting = true;
  const previousBot = bot;
  if (previousBot) {
    bot = null;
    isConnected = false;
    try {
      previousBot.removeAllListeners();
      previousBot.end();
    } catch { /* ignore stale socket cleanup */ }
  }
  const generation = ++botGeneration;

  try {
    const botOptions: Parameters<typeof mineflayer.createBot>[0] = {
      host: MC_HOST,
      port: MC_PORT,
      username: MC_BOT_NICK,
      auth: MC_MODE === "online" ? "microsoft" : "offline",
    };

    const currentBot = mineflayer.createBot(botOptions);
    bot = currentBot;
    loginSent = false;
    spawnCount = 0;

    currentBot.on("spawn", async () => {
      if (generation !== botGeneration || bot !== currentBot) {
        try { currentBot.end(); } catch { /* ignore stale bot */ }
        return;
      }
      spawnCount++;
      isConnected = true;
      isConnecting = false; // successfully connected — clear the guard
      reconnectDelay = 5000; // reset backoff on successful connect
      logger.info({ host: MC_HOST, port: MC_PORT, nick: MC_BOT_NICK }, "MC bot spawned");
      await logEvent("info", "minecraft", "Bot MC połączony i zrodził się");

      // Auto-login for AuthMe (offline servers)
      if (MC_MODE === "offline" && MC_BOT_PASSWORD && !loginSent) {
        loginSent = true;
        setTimeout(() => {
          try {
            currentBot.chat(`/login ${MC_BOT_PASSWORD}`);
          } catch { /* ignore */ }
        }, 1500);
      }

      // ── Anti-AFK — swing arm every 90 seconds to avoid kick ──────
      startAntiAfk();
    });

    // ── MC→DC relay via mineflayer's chat event (already parses nick+msg) ──
    currentBot.on("chat", async (username: string, message: string) => {
      if (generation !== botGeneration || bot !== currentBot) return;
      if (!isConnected) return;
      if (!username || !message) return;

      // Ignore our own echoed messages
      if (username === MC_BOT_NICK) return;

      // Ignore messages relayed from Discord (loop prevention)
      if (message.startsWith("[DC]")) return;

      // Handle public commands
      if (message.startsWith("=")) {
        await handleMcPublicCommand(username, message);
        return;
      }

      await logChat("mc", username, message);
    });

    // Handle whispers (private messages to bot)
    currentBot.on("whisper" as any, async (username: string, message: string) => {
      if (generation !== botGeneration || bot !== currentBot) return;
      await handleMcWhisperCommand(username, message.trim());
    });

    currentBot.on("error", (err) => {
      if (generation !== botGeneration) return;
      logger.error({ err: String(err) }, "MC bot error");
      isConnected = false;
      isConnecting = false;
      scheduleReconnect();
    });

    currentBot.on("end", (reason) => {
      if (generation !== botGeneration) return;
      logger.warn({ reason }, "MC bot disconnected");
      isConnected = false;
      isConnecting = false;
      bot = null;
      loginSent = false;
      stopAntiAfk();
      scheduleReconnect();
    });

    currentBot.on("kicked", async (reason) => {
      if (generation !== botGeneration) return;
      logger.warn({ reason }, "MC bot kicked");
      isConnected = false;
      isConnecting = false;
      stopAntiAfk();
      await logEvent("warn", "minecraft", `Bot wyrzucony: ${reason}`);
      const reasonText = String(reason).toLowerCase();
      if (reasonText.includes("throttled") || reasonText.includes("duplicate_login")) {
        reconnectDelay = Math.max(reconnectDelay, 30_000);
      }
      scheduleReconnect();
    });

  } catch (err) {
    logger.error({ err: String(err) }, "Failed to create MC bot");
    scheduleReconnect();
  }
}

async function handleMcPublicCommand(playerNick: string, message: string): Promise<void> {
  const parts = message.slice(1).trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? "";

  switch (cmd) {
    case "pomoc":
      botWhisper(playerNick, "§e=== PackSMP Komendy ===");
      botWhisper(playerNick, "§f/msg BotNick §7=pomoc §f- Lista komend");
      botWhisper(playerNick, "§f/msg BotNick §7=weryfikacja §f- Status weryfikacji");
      botWhisper(playerNick, "§f/msg BotNick §7=verify <kod> §f- Zweryfikuj konto Discord");
      botWhisper(playerNick, "§f/msg BotNick §7=msg <nick> <wiad> §f- Prywatna wiadomość");
      botWhisper(playerNick, "§f/msg BotNick §7=status §f- Status systemu");
      break;

    case "status":
      botWhisper(playerNick, `§eStatus systemu: §aMC §aBot online §f| §fSync: ${bridgeService.isSyncEnabled() ? "§a✓ aktywna" : "§c✗ wyłączona"}`);
      break;

    case "verify":
    case "zweryfikujkontodc": {
      const code = parts[1] ?? "";
      if (!code) {
        botWhisper(playerNick, "§cUżycie: §e=verify <kod>");
        return;
      }
      botWhisper(playerNick, "§7Weryfikuję kod...");
      const result = await verifyCode(playerNick, code);
      if (result.success && result.discordId) {
        botWhisper(playerNick, "§a✓ Weryfikacja zakończona sukcesem!");
        botWhisper(playerNick, "§fTwoje konto Minecraft zostało połączone z kontem Discord.");
        await onVerificationSuccess(result.discordId, playerNick);
      } else {
        botWhisper(playerNick, `§c✗ ${result.error ?? "Weryfikacja nieudana."}`);
      }
      break;
    }

    case "weryfikacja": {
      const status = await getVerificationStatusByMcNick(playerNick);
      if (status?.isVerified) {
        botWhisper(playerNick, `§a✓ §fTwoje konto jest zweryfikowane. Discord ID: §e${status.discordId}`);
      } else {
        botWhisper(playerNick, "§c✗ §fTwoje konto nie jest zweryfikowane. Wygeneruj kod na Discordzie i użyj §e/msg BotNick =verify <kod>");
      }
      break;
    }
  }
}

async function handleMcWhisperCommand(playerNick: string, message: string): Promise<void> {
  if (!message.startsWith("=")) {
    botWhisper(playerNick, "§cNieznana komenda. Użyj §e=pomoc §caby zobaczyć listę.");
    return;
  }

  const parts = message.slice(1).trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? "";

  switch (cmd) {
    case "pomoc":
      botWhisper(playerNick, "§e=== PackSMP Komendy (whisper) ===");
      botWhisper(playerNick, "§e=pomoc §f- Ta wiadomość");
      botWhisper(playerNick, "§e=weryfikacja §f- Status weryfikacji konta");
      botWhisper(playerNick, "§e=verify <kod> §f- Zweryfikuj konto Discord (prywatne)");
      botWhisper(playerNick, "§e=msg <nick/discordid> <wiad> §f- Prywatna wiadomość");
      botWhisper(playerNick, "§e=status §f- Status systemu");
      break;

    case "weryfikacja": {
      const status = await getVerificationStatusByMcNick(playerNick);
      if (status?.isVerified) {
        botWhisper(playerNick, `§a✓ Konto zweryfikowane! Discord: §e${status.discordId} §f| Zweryfikowane: §e${status.verifiedAt?.toLocaleDateString("pl-PL")}`);
      } else {
        botWhisper(playerNick, "§c✗ Konto nie jest zweryfikowane.");
        botWhisper(playerNick, "§fWygeneruj kod na Discordzie, potem: §e=verify <kod>");
      }
      break;
    }

    case "verify":
    case "zweryfikujkontodc": {
      const code = parts[1] ?? "";
      if (!code) {
        botWhisper(playerNick, "§cUżycie: §e=verify <kod>");
        return;
      }
      botWhisper(playerNick, "§7Weryfikuję kod...");
      const result = await verifyCode(playerNick, code);
      if (result.success && result.discordId) {
        botWhisper(playerNick, "§a✓ Weryfikacja zakończona sukcesem!");
        botWhisper(playerNick, `§fTwoje konto Minecraft zostało połączone z kontem Discord.`);
        // Notify verification service to grant Discord role
        onVerificationSuccess(result.discordId, playerNick);
      } else {
        botWhisper(playerNick, `§c✗ ${result.error ?? "Weryfikacja nieudana."}`);
      }
      break;
    }

    case "msg": {
      const toNick = parts[1];
      const msgText = parts.slice(2).join(" ");
      if (!toNick || !msgText) {
        botWhisper(playerNick, "§cUżycie: §e=msg <nick> <wiadomość>");
        return;
      }
      const result = await sendPrivateMessage("mc", playerNick, playerNick, toNick, msgText);
      if (result.success) {
        botWhisper(playerNick, `§a→ §fWiadomość do §e${toNick}§f: ${msgText}`);
        // Try to deliver immediately via Discord if it's a Discord user
        await tryDeliverToDiscord(playerNick, toNick, msgText);
      } else {
        botWhisper(playerNick, `§c✗ ${result.error}`);
      }
      break;
    }

    case "status":
      botWhisper(playerNick, `§eStatus: §aMC Bot online §f| Sync: ${bridgeService.isSyncEnabled() ? "§aaktywna" : "§cwyłączona"}`);
      break;

    default:
      botWhisper(playerNick, `§cNieznana komenda: §e=${cmd}§c. Użyj §e=pomoc`);
  }
}

async function tryDeliverToDiscord(fromMcNick: string, toDiscordId: string, message: string): Promise<void> {
  if (!discordClientRef) return;
  try {
    // Try to find the Discord user by ID
    const user = await discordClientRef.users.fetch(toDiscordId).catch(() => null);
    if (user) {
      const dm = await user.createDM();
      await dm.send(`📨 **Prywatna wiadomość od** \`${fromMcNick}\` **(Minecraft)**:\n> ${message}`);
      // Mark as delivered
      const pending = await getPendingMessagesForDiscordId(toDiscordId);
      const ids = pending.filter(m => m.fromId === fromMcNick && m.message === message).map(m => m.id);
      await markMessagesDelivered(ids);
    }
  } catch { /* recipient offline or DMs closed */ }
}

// Callback for when verification succeeds — Discord bot will pick this up
let verificationSuccessCallback: ((discordId: string, mcNick: string) => Promise<void>) | null = null;

export function setVerificationSuccessCallback(cb: (discordId: string, mcNick: string) => Promise<void>): void {
  verificationSuccessCallback = cb;
}

async function onVerificationSuccess(discordId: string, mcNick: string): Promise<void> {
  if (verificationSuccessCallback) {
    await verificationSuccessCallback(discordId, mcNick).catch(err => {
      logger.error({ err: String(err) }, "Error in verification success callback");
    });
  }
}

function botWhisper(playerNick: string, message: string): void {
  try {
    bot?.chat(`/tell ${playerNick} ${message}`);
  } catch { /* ignore */ }
}

/** Strip characters Minecraft chat doesn't allow (outside printable ASCII 0x20–0x7E, plus §). */
function sanitizeForMc(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, (ch) => {
      // Keep common punctuation approximations
      const map: Record<string, string> = {
        "ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n",
        "ó": "o", "ś": "s", "ź": "z", "ż": "z",
        "Ą": "A", "Ć": "C", "Ę": "E", "Ł": "L", "Ń": "N",
        "Ó": "O", "Ś": "S", "Ź": "Z", "Ż": "Z",
      };
      return map[ch] ?? "";
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240); // Minecraft chat limit ~256 chars
}

export async function sendChatMessage(message: string): Promise<boolean> {
  if (!bot || !isConnected) return false;
  try {
    const safe = sanitizeForMc(message);
    if (!safe) return false;
    bridgeService.markSent(safe);
    bot.chat(safe);
    return true;
  } catch (err) {
    logger.error({ err: String(err) }, "Failed to send MC chat message");
    return false;
  }
}

function scheduleReconnect(): void {
  // error + end/kicked can fire together; keep only one reconnect timer
  isConnecting = true; // block watchdog from spawning a second bot while we wait
  if (reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 60_000); // exponential backoff, cap at 60s
  logger.info({ delayMs: delay }, "Scheduling MC bot reconnect");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    isConnecting = false; // allow connectMinecraft() to proceed
    logger.info("Reconnecting MC bot...");
    connectMinecraft();
  }, delay);
}

export function getOnlinePlayers(): string[] {
  if (!bot || !isConnected) return [];
  try {
    return Object.keys(bot.players).filter(nick => nick !== MC_BOT_NICK);
  } catch { return []; }
}

export function getMcBotStatus(): { connected: boolean; reconnecting: boolean; username: string; host: string; port: number } {
  return {
    connected: isConnected,
    reconnecting: isConnecting,
    username: MC_BOT_NICK,
    host: MC_HOST,
    port: MC_PORT,
  };
}

export function disconnectMinecraft(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (bot) {
    try { bot.quit(); } catch { /* ignore */ }
    bot = null;
  }
  isConnected = false;
}

export function restartMinecraft(): void {
  disconnectMinecraft();
  setTimeout(() => connectMinecraft(), 2000);
}

// Deliver pending messages to player when they join (called externally)
export async function deliverPendingToPlayer(mcNick: string): Promise<void> {
  if (!bot || !isConnected) return;
  const pending = await getPendingMessagesForMcNick(mcNick);
  if (pending.length === 0) return;

  const ids: string[] = [];
  for (const msg of pending) {
    botWhisper(mcNick, `§d[Wiadomość od §e${msg.fromDisplay}§d]: §f${msg.message}`);
    ids.push(msg.id);
    await new Promise(r => setTimeout(r, 500));
  }
  await markMessagesDelivered(ids);
}
