import {
  Client,
  GatewayIntentBits,
  Partials,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type Message,
  PermissionsBitField,
  MessageFlags,
  Events,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { bridgeService } from "./bridge.js";
import { generateVerificationCode, getVerificationStatusByDiscord, getVerificationStatusByMcNick, unlinkAccount, manualVerify, changeNick } from "./verification.js";
import { sendPrivateMessage, getPendingMessagesForDiscordId, markMessagesDelivered } from "./privmsg.js";
import { logChat, logEvent, getRecentLogs, getRecentChats } from "./system-log.js";
import { sendChatMessage, getMcBotStatus, restartMinecraft, setVerificationSuccessCallback, getOnlinePlayers } from "./minecraft-bot.js";
import { getRconStatus } from "./rcon.js";
import { db } from "@workspace/db";
import { verifiedUsersTable, pendingFormAnswersTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"] ?? "";
const GUILD_ID = process.env["DISCORD_GUILD_ID"] ?? "";
const BLACKLIST_CHANNEL_ID = "1536657390781472838";
const RECRUIT_WAITING_CHANNEL_ID = "1534985918140649544";
const RECRUIT_ROLE_ID = "1534975728263626853";
const CHAT_CHANNEL_ID = process.env["DISCORD_CHAT_CHANNEL_ID"] ?? "";
const VERIFY_ROLE_ID = process.env["DISCORD_VERIFY_ROLE_ID"] ?? "";
const BOT_NICK = process.env["MC_BOT_NICK"] ?? "SyncBot";
const MODERATOR_ROLE_ID = "1532085181111079054";
const SMP_ROLE_ID = "1533741682380636281";
const SMP_ROLE_CHANNEL_ID = "1537412979652436069";

type TicketType = "rekrutacja" | "sojusz" | "konkurs" | "walka";
type TicketFormField = {
  id: string;
  label: string;
  placeholder: string;
  style: TextInputStyle;
  required?: boolean;
};
type TicketForm = {
  title: string;
  intro: string;
  color: number;
  footer: string;
  /** Each inner array = one Discord modal page (max 5 fields) */
  pages: TicketFormField[][];
};

// ── DB-backed pending form answers ────────────────────────────────────────────
// Persisted to the database so bot restarts don't lose partial submissions.

async function dbGetFormAnswers(key: string): Promise<Record<string, string>> {
  try {
    const rows = await db.select().from(pendingFormAnswersTable).where(eq(pendingFormAnswersTable.key, key));
    if (rows.length === 0) return {};
    return JSON.parse(rows[0]!.answers) as Record<string, string>;
  } catch { return {}; }
}

async function dbSetFormAnswers(key: string, userId: string, ticketType: string, answers: Record<string, string>): Promise<void> {
  try {
    await db.insert(pendingFormAnswersTable)
      .values({ key, userId, ticketType, answers: JSON.stringify(answers), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: pendingFormAnswersTable.key,
        set: { answers: JSON.stringify(answers), updatedAt: new Date() },
      });
  } catch (err) { logger.warn({ err: String(err) }, "Failed to persist form answers"); }
}

async function dbDeleteFormAnswers(key: string): Promise<void> {
  try {
    await db.delete(pendingFormAnswersTable).where(eq(pendingFormAnswersTable.key, key));
  } catch { /* ignore */ }
}

// Cleanup stale entries older than 7 days (called from watchdog periodically)
export async function cleanupStaleFormAnswers(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await db.delete(pendingFormAnswersTable).where(lt(pendingFormAnswersTable.updatedAt, cutoff));
  } catch { /* ignore */ }
}

const TICKET_FORMS: Record<TicketType, TicketForm> = {
  rekrutacja: {
    title: "📋 Formularz rekrutacyjny",
    intro: "Wypełnij formularz rekrutacyjny PackSMP. Formularz składa się z 3 stron — po wypełnieniu każdej kliknij Wyślij.",
    color: 0x5865F2,
    footer: "PackSMP • Rekrutacja",
    pages: [
      // Strona 1 / 3
      [
        { id: "nick",      label: "Jaki masz nick?",                               placeholder: "Twój nick Minecraft",          style: TextInputStyle.Short },
        { id: "wiek",      label: "Ile masz lat?",                                 placeholder: "Twój wiek",                    style: TextInputStyle.Short },
        { id: "zwrot",     label: "Jak mamy się do Ciebie zwracać?",               placeholder: "Imię, pseudonim...",           style: TextInputStyle.Short },
        { id: "pvp",       label: "Jak oceniasz swoje PvP? (1–10)",                placeholder: "np. 7",                        style: TextInputStyle.Short },
        { id: "build",     label: "Jak oceniasz swoje budowanie? (1–10)",          placeholder: "np. 6",                        style: TextInputStyle.Short },
      ],
      // Strona 2 / 3
      [
        { id: "aktywnosc", label: "Jak oceniasz swoją aktywność? (1–10)",          placeholder: "np. 8",                        style: TextInputStyle.Short },
        { id: "czas",      label: "Ile czasu dziennie możesz poświęcić na grę?",   placeholder: "np. 2–3 godziny",              style: TextInputStyle.Short },
        { id: "panstwa",   label: "W jakich państwach grałeś wcześniej?",          placeholder: "Wymień nazwy państw",          style: TextInputStyle.Paragraph },
        { id: "rangi",     label: "Jakie miałeś tam rangi/funkcje?",               placeholder: "np. Lider, Budowniczy...",     style: TextInputStyle.Paragraph },
        { id: "osiag",     label: "Jakie są Twoje największe osiągnięcia?",        placeholder: "Opisz swoje sukcesy",          style: TextInputStyle.Paragraph },
      ],
      // Strona 3 / 3
      [
        { id: "najlepszy", label: "W czym jesteś najlepszy?",                      placeholder: "PvP / Build / Ekonomia / Redstone / Alchemia / Inne", style: TextInputStyle.Short },
        { id: "mikrofon",  label: "Czy posiadasz sprawny mikrofon?",               placeholder: "Tak / Nie",                    style: TextInputStyle.Short },
        { id: "discord",   label: "Czy jesteś aktywny na Discordzie?",             placeholder: "Tak / Nie / Czasami",          style: TextInputStyle.Short },
        { id: "dlaczego",  label: "Dlaczego chcesz dołączyć właśnie do naszego państwa?", placeholder: "Opisz swoją motywację",        style: TextInputStyle.Paragraph },
        { id: "wybor",     label: "Dlaczego powinniśmy wybrać właśnie Ciebie?",   placeholder: "Co Cię wyróżnia?",             style: TextInputStyle.Paragraph },
      ],
    ],
  },
  sojusz: {
    title: "🤝 Formularz sojuszu",
    intro: "Przedstaw propozycję sojuszu.",
    color: 0x57F287,
    footer: "PackSMP • Sojusze",
    pages: [[
      { id: "group_name",   label: "Nazwa grupy/serwera",  placeholder: "Nazwa Waszej grupy",     style: TextInputStyle.Short },
      { id: "members",      label: "Liczba członków",       placeholder: "Ile osób liczy grupa?",  style: TextInputStyle.Short },
      { id: "offer",        label: "Co oferujecie?",        placeholder: "Opisz propozycję",       style: TextInputStyle.Paragraph },
      { id: "expectations", label: "Czego oczekujecie?",    placeholder: "Opisz oczekiwania",      style: TextInputStyle.Paragraph },
    ]],
  },
  konkurs: {
    title: "🏆 Formularz zgłoszenia wygranej",
    intro: "Podaj informacje potrzebne do odebrania nagrody.",
    color: 0xFEE75C,
    footer: "PackSMP • Konkursy",
    pages: [[
      { id: "mc_nick",  label: "Nick Minecraft",    placeholder: "Twój nick Minecraft",          style: TextInputStyle.Short },
      { id: "contest",  label: "Nazwa konkursu",     placeholder: "W którym konkursie wygrałeś?", style: TextInputStyle.Short },
      { id: "proof",    label: "Dowód wygranej",     placeholder: "Link lub opis dowodu",         style: TextInputStyle.Paragraph },
      { id: "prize",    label: "Wygrana nagroda",    placeholder: "Jaką nagrodę wygrałeś?",       style: TextInputStyle.Short },
    ]],
  },
  walka: {
    title: "⚔️ Formularz walki klatki",
    intro: "Przedstaw propozycję walki klatki. Formularz składa się z 3 stron — po wypełnieniu każdej kliknij Wyślij.",
    color: 0xED4245,
    footer: "PackSMP • Walki",
    pages: [
      // Strona 1 / 3
      [
        { id: "panstwo_my",   label: "Nazwa naszego państwa",      placeholder: "Twoje państwo",         style: TextInputStyle.Short },
        { id: "panstwo_oni",  label: "Nazwa przeciwnego państwa",   placeholder: "Państwo przeciwnika",   style: TextInputStyle.Short },
        { id: "lider_my",     label: "Lider naszego państwa",       placeholder: "Nick lidera",           style: TextInputStyle.Short },
        { id: "lider_oni",    label: "Lider przeciwnego państwa",   placeholder: "Nick lidera",           style: TextInputStyle.Short },
      ],
      // Strona 2 / 3
      [
        { id: "zawodnicy",    label: "Liczba zawodników",           placeholder: "np. 5v5",               style: TextInputStyle.Short },
        { id: "tryb",         label: "Tryb walki",                  placeholder: "np. UHC, Normal...",    style: TextInputStyle.Short },
        { id: "data",         label: "Proponowana data",            placeholder: "np. 20.08.2025",        style: TextInputStyle.Short },
        { id: "godzina",      label: "Proponowana godzina",         placeholder: "np. 18:00",             style: TextInputStyle.Short },
      ],
      // Strona 3 / 3
      [
        { id: "zasady",       label: "Zasady walki",                placeholder: "Opisz zasady",          style: TextInputStyle.Paragraph },
        { id: "nagroda",      label: "Nagroda",                     placeholder: "Co stawia każda strona?", style: TextInputStyle.Short },
        { id: "osoba",        label: "Osoba odpowiedzialna",        placeholder: "Nick koordynatora",     style: TextInputStyle.Short },
        { id: "akceptacja",   label: "Czy obie strony zaakceptowały zasady?", placeholder: "Tak / Nie / Jeszcze nie", style: TextInputStyle.Short },
      ],
    ],
  },
};

const RESULT_FORM_PAGES: TicketFormField[][] = [
  [
    { id: "status",       label: "Status rekrutacji", placeholder: "zdana lub niezdana", style: TextInputStyle.Short },
    { id: "participant",  label: "Uczestnik",         placeholder: "@osoba lub nick Discord", style: TextInputStyle.Short },
    { id: "examiner",     label: "Egzaminator",       placeholder: "np. @CWT | IzraelskiMichal", style: TextInputStyle.Short },
    { id: "pvp_level",    label: "Poziom PvP",        placeholder: "np. T3", style: TextInputStyle.Short },
    { id: "total_result", label: "Łączny wynik",      placeholder: "np. IzraelskiMichal 10-0", style: TextInputStyle.Short },
  ],
  [
    {
      id: "rounds",
      label: "Wyniki rund",
      placeholder: "Jedna runda w jednej linii, np. Castplay.pl 1-0",
      style: TextInputStyle.Paragraph,
    },
    {
      id: "notes",
      label: "Uwagi",
      placeholder: "Brak dodatkowych uwag",
      style: TextInputStyle.Paragraph,
      required: false,
    },
  ],
];

const TEST_RESULT_ANSWERS: Record<string, string> = {
  status: "niezdana",
  participant: "@SLIMAK WODNY",
  examiner: "@CWT | IzraelskiMichal",
  pvp_level: "T3",
  rounds: [
    "Castplay.pl 1-0",
    "Castplay.pl 1-0",
    "Castplay.pl 1-0",
    "Castplay.pl 1-0",
    "Diamond SMP 1-0",
    "Diamond SMP 1-0",
    "Diamond SMP 1-0",
    "Netherite + Pot 1-0",
    "Netherite + Pot 1-0",
    "Netherite + Pot 1-0",
  ].join("\n"),
  total_result: "IzraelskiMichal 10-0",
  notes: "Brak dodatkowych uwag",
};

let client: Client | null = null;
let isReady = false;
let isConnecting = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function getDiscordClient(): Client | null {
  return client;
}

export function getDiscordStatus(): { connected: boolean; username: string | null; guilds: number } {
  return {
    connected: isReady,
    username: client?.user?.tag ?? null,
    guilds: client?.guilds?.cache?.size ?? 0,
  };
}

export async function startDiscordBot(): Promise<void> {
  if (client && (isReady || isConnecting || reconnectTimer)) return;

  if (client) {
    try { client.destroy(); } catch { /* ignore */ }
    client = null;
    isReady = false;
  }
  isConnecting = true;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User],
  });

  // Set MC verification success callback
  setVerificationSuccessCallback(async (discordId: string, mcNick: string) => {
    await onMcVerificationSuccess(discordId, mcNick);
  });

  client.on(Events.ClientReady, async () => {
    isReady = true;
    isConnecting = false;
    logger.info({ tag: client?.user?.tag }, "Discord bot ready");
    await logEvent("info", "discord", `Bot gotowy jako ${client?.user?.tag}`);

    // ── Backfill: send forms to ticket channels that are missing them ──────────
    // Runs every time the bot connects/reconnects. Catches channels created
    // while the bot was offline (MC restarts, throttling, etc.).
    setTimeout(() => backfillTicketForms().catch((err) => {
      logger.warn({ err: String(err) }, "Backfill ticket forms failed");
    }), 5000); // 5s delay — let Discord finish feeding initial state
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (message.channel.isDMBased()) return;

    // Commands with = prefix
    if (!message.content.startsWith("=")) return;

    const args = message.content.slice(1).trim().split(/\s+/);
    const cmd = args[0]?.toLowerCase() ?? "";

    await handleDiscordCommand(message, cmd, args.slice(1));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton()) {
        await handleButtonInteraction(interaction as ButtonInteraction);
      } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction as ModalSubmitInteraction);
      }
    } catch (err) {
      logger.error({ err: String(err) }, "InteractionCreate handler error");
      try {
        const reply = { content: "❌ Wystąpił błąd. Spróbuj ponownie.", flags: MessageFlags.Ephemeral };
        if ((interaction as any).replied || (interaction as any).deferred) {
          await (interaction as any).followUp(reply);
        } else {
          await (interaction as any).reply(reply);
        }
      } catch { /* ignore secondary error */ }
    }
  });

  // ── Ticket handler ────────────────────────────────────────────────────────

  client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.isTextBased()) return;

    // Wait for the ticket bot to set up permissions and post its welcome message
    await new Promise<void>((r) => setTimeout(r, 4000));

    try {
      const info = await detectTicketChannel(channel as TextChannel);
      if (!info) return; // not a ticket channel
      logger.info({ channelId: channel.id, channelName: (channel as any).name, ticketType: info.ticketType }, "Ticket channel detected via ChannelCreate");
      await sendTicketFormToChannel(channel as TextChannel, info.ticketType, info.userId, info.mentioned, (channel as any).name?.toLowerCase() ?? "");
    } catch (err) {
      logger.warn({ err: String(err), channelId: channel.id }, "Ticket ChannelCreate handler failed");
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    // Deliver pending messages to newly joined members
    const pending = await getPendingMessagesForDiscordId(member.id);
    if (pending.length === 0) return;
    const ids: string[] = [];
    for (const msg of pending) {
      try {
        const dm = await member.createDM();
        await dm.send(`📨 **Wiadomość od** \`${msg.fromDisplay}\` **(Minecraft)**:\n> ${msg.message}`);
        ids.push(msg.id);
      } catch { /* ignore */ }
    }
    await markMessagesDelivered(ids);
  });

  client.on("error", (err) => {
    logger.error({ err: String(err) }, "Discord bot error");
    isReady = false;
    isConnecting = false;
    scheduleReconnect();
  });

  client.on("disconnect", () => {
    logger.warn("Discord bot disconnected");
    isReady = false;
    isConnecting = false;
    scheduleReconnect();
  });

  try {
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    logger.error({ err: String(err) }, "Discord login failed");
    isReady = false;
    isConnecting = false;
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    logger.info("Reconnecting Discord bot...");
    startDiscordBot().catch(() => {});
  }, 20000);
}

// ── detectTicketChannel ───────────────────────────────────────────────────────
// Returns ticket info if the channel looks like a ticket, null otherwise.
// Detection strategy (in order):
//   1. Channel has exactly one non-bot member with an explicit permission overwrite
//      (type 1 = member overwrite) — this is how EVERY ticket bot works regardless
//      of channel naming convention.
//   2. Channel name / parent name contains known ticket keywords (fallback).
//
// Both ChannelCreate and backfill use this function so behaviour is identical.

interface TicketDetection {
  ticketType: TicketType;
  userId: string | null;
  mentioned: Set<string>;
}

// Channels that must never receive ticket forms (known non-ticket channels).
// CHAT_CHANNEL_ID is added lazily because it comes from an env var.
const TICKET_EXCLUDED_CHANNEL_IDS = new Set([
  BLACKLIST_CHANNEL_ID,
  RECRUIT_WAITING_CHANNEL_ID,
  SMP_ROLE_CHANNEL_ID,
]);
if (CHAT_CHANNEL_ID) TICKET_EXCLUDED_CHANNEL_IDS.add(CHAT_CHANNEL_ID);

// Channel names that are clearly not tickets (log channels, chat channels, etc.)
const TICKET_EXCLUDED_NAME_FRAGMENTS = [
  "logi", "log-", "-log", "logs", "archiv", "zamkniet", "closed",
  "blacklista", "blacklist", "lista-kret", "admin", "staff", "moderato",
  "ogłosz", "announce", "general", "głosow", "vote", "rules", "zasad",
  "chat-mc", "mc-dc", "chat-dc", "sync", "bridge",
];

// Maximum channel age for automatic ticket detection (30 days)
const TICKET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

async function detectTicketChannel(channel: TextChannel): Promise<TicketDetection | null> {
  // Hard exclusions — known non-ticket channels
  if (TICKET_EXCLUDED_CHANNEL_IDS.has(channel.id)) return null;

  const name = channel.name.toLowerCase();
  const parentName = (channel as any).parent?.name?.toLowerCase?.() ?? "";

  // Skip channels whose name strongly suggests they are not tickets
  if (TICKET_EXCLUDED_NAME_FRAGMENTS.some(f => name.includes(f))) return null;

  // Only process channels created in the last 30 days (tickets are always recent)
  const age = Date.now() - (channel.createdTimestamp ?? 0);
  if (age > TICKET_MAX_AGE_MS) return null;

  // ── 1. Permission-based detection (primary — works with any ticket bot) ────
  const mentioned = new Set<string>();
  const overwrites = (channel as any).permissionOverwrites?.cache;
  const nonBotMemberIds: string[] = [];
  for (const ow of overwrites?.values?.() ?? []) {
    if (ow.type !== 1) continue; // skip role overwrites and @everyone
    try {
      const member =
        (channel as any).guild?.members?.cache?.get(ow.id) ??
        await (channel as any).guild?.members?.fetch(ow.id);
      if (member && !member.user.bot) {
        nonBotMemberIds.push(ow.id);
        mentioned.add(ow.id);
      }
    } catch { /* member left or stale overwrite */ }
  }

  const hasExplicitMemberOverwrite = nonBotMemberIds.length >= 1;

  // ── 2. Name-based fallback ────────────────────────────────────────────────
  const nameMatch =
    name.includes("rekrutacja") || name.includes("recruit") ||
    name.includes("aplikacja") || name.includes("sojusz") ||
    name.includes("wasal") || name.includes("alliance") ||
    name.includes("konkurs") || name.includes("nagroda") ||
    name.includes("walka") || name.includes("klatka") ||
    name.includes("wyzwanie") || name.includes("fight") ||
    name.includes("ticket") || name.includes("zgloszenie") ||
    name.includes("zgłoszenie") ||
    parentName.includes("ticket") || parentName.includes("support") ||
    parentName.includes("pomoc") || parentName.includes("zgłoszenia") ||
    parentName.includes("rekrutacja") || parentName.includes("tickety");

  if (!hasExplicitMemberOverwrite && !nameMatch) return null;

  // Fetch recent messages to detect ticket type and gather more mentions
  let messages;
  try {
    messages = await channel.messages.fetch({ limit: 15 });
  } catch { return null; }

  // Collect mentions from messages
  for (const msg of messages.values()) {
    for (const m of msg.content.matchAll(/<@!?(\d+)>/g)) mentioned.add(m[1]!);
    for (const embed of msg.embeds) {
      const t = `${embed.description ?? ""} ${embed.fields.map(f => f.value).join(" ")}`;
      for (const m of t.matchAll(/<@!?(\d+)>/g)) mentioned.add(m[1]!);
    }
  }
  if ((channel as any).topic) {
    for (const m of ((channel as any).topic as string).matchAll(/<@!?(\d+)>/g)) mentioned.add(m[1]!);
  }

  // Find the human ticket opener (first non-bot mentioned)
  let userId: string | null = null;
  // Prefer the member with explicit overwrite (most reliable)
  if (nonBotMemberIds.length > 0) {
    userId = nonBotMemberIds[0]!;
  } else {
    for (const uid of mentioned) {
      try {
        const u = await client!.users.fetch(uid);
        if (!u.bot) { userId = uid; break; }
      } catch { /* ignore */ }
    }
  }

  // Detect ticket type from all available text
  const allText = [
    name,
    (channel as any).topic ?? "",
    ...[...messages.values()].map(m =>
      `${m.content} ${m.embeds.map(e => `${e.title ?? ""} ${e.description ?? ""} ${e.fields.map(f => `${f.name} ${f.value}`).join(" ")}`).join(" ")}`
    ),
  ].join(" ").toLowerCase();
  const has = (kw: string[]) => kw.some(k => allText.includes(k));

  let ticketType: TicketType;
  if (name.includes("sojusz") || name.includes("wasal") || name.includes("alliance") ||
      has(["sojusz", "wasal", "sojusznikiem", "sojusznik", "chcemy sojusz"])) {
    ticketType = "sojusz";
  } else if (name.includes("konkurs") || name.includes("nagroda") ||
             has(["wygrałem", "wygralem", "konkurs", "zająłem miejsce", "nagroda za", "wygrana"])) {
    ticketType = "konkurs";
  } else if (name.includes("walka") || name.includes("klatka") || name.includes("wyzwanie") ||
             has(["walka klatki", "zawalczyć", "zawalczyc", "klatka", "pojedynek", "wyzwam"])) {
    ticketType = "walka";
  } else {
    ticketType = "rekrutacja"; // default — most common ticket type
  }

  return { ticketType, userId, mentioned };
}

// ── Backfill: send forms to existing ticket channels that missed auto-send ────
// Called on every bot connect/reconnect AND every 5 minutes via watchdog.
// Idempotent — skips channels where the bot already posted a form button.

export async function backfillTicketForms(): Promise<void> {
  if (!client?.isReady()) return;

  const guild = client.guilds.cache.first();
  if (!guild) { logger.warn("Backfill: no guild found"); return; }

  const channels = await guild.channels.fetch();
  const botId = client.user!.id;

  let filled = 0;

  for (const [, ch] of channels) {
    if (!ch || !ch.isTextBased()) continue;

    try {
      // Skip if bot already posted a form button here
      const messages = await (ch as TextChannel).messages.fetch({ limit: 50 });
      const alreadySent = [...messages.values()].some(
        (m) => m.author.id === botId &&
          m.components.some((row) =>
            (row as any).components?.some(
              (c: any) => typeof c?.customId === "string" &&
                c.customId.startsWith("fill_form_page:")
            )
          )
      );
      if (alreadySent) continue;

      const info = await detectTicketChannel(ch as TextChannel);
      if (!info) continue;

      logger.info({ channelId: ch.id, channelName: ch.name, ticketType: info.ticketType, userId: info.userId }, "Backfill: sending form to missed ticket channel");
      await sendTicketFormToChannel(ch as TextChannel, info.ticketType, info.userId, info.mentioned, ch.name.toLowerCase());
      filled++;

      // Pace sends to avoid Discord rate limits
      await new Promise<void>((r) => setTimeout(r, 2500));
    } catch (err) {
      logger.warn({ err: String(err), channelId: ch.id }, "Backfill: failed to process channel");
    }
  }

  if (filled > 0) logger.info({ filled }, "Backfill: ticket forms sent");
}

// ── Shared ticket form sender ─────────────────────────────────────────────────
// Used by both ChannelCreate auto-detection and the =formularz admin command.

async function sendTicketFormToChannel(
  channel: TextChannel,
  ticketType: TicketType,
  userId: string | null,
  mentioned: Set<string>,
  channelName: string,
): Promise<void> {
  const form = TICKET_FORMS[ticketType];
  const safeUid = userId ?? "unknown";
  const pageCountLabel = form.pages.length === 1
    ? "Wypełnij formularz poniżej."
    : `Wypełnij wszystkie ${form.pages.length} strony formularza poniżej.`;

  await channel.send({
    content:
      `👋 Witaj${userId ? ` <@${userId}>` : ""}!\n\n` +
      `${form.intro}\n\n` +
      `${pageCountLabel} ⬇️`,
  });

  // Each page is a separate message + button (Discord modals can't change pages)
  for (const [pageIndex] of form.pages.entries()) {
    const pageButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`fill_form_page:${ticketType}:${safeUid}:${pageIndex}`)
        .setLabel(`📝 Otwórz formularz — ${pageIndex + 1}. strona`)
        .setStyle(ButtonStyle.Primary)
    );
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`📋 Formularz — ${pageIndex + 1}. strona`)
          .setColor(form.color)
          .setDescription(
            `${form.title}\n\n` +
            `Kliknij przycisk poniżej, aby wypełnić **${pageIndex + 1}. stronę** formularza.`
          )
          .setFooter({ text: `${form.footer} • Strona ${pageIndex + 1}/${form.pages.length}` }),
      ],
      components: [pageButton],
    });
  }

  logger.info({ channelId: channel.id, ticketType, userId }, "Ticket form prompt sent");

  // ── Blacklist check (only for rekrutacja) ──────────────────────────────────
  if (ticketType === "rekrutacja") {
    const nameParts = channelName.split(/[-_]/);
    const { getBlacklist } = await import("./blacklist.js");
    const blacklist = await getBlacklist();

    const sendBlWarn = async (blEntry: { nick: string; discordId: string; reason: string | null }, byId: boolean) => {
      const warnEmbed = new EmbedBuilder()
        .setTitle("⛔ UWAGA — Osoba na blackliście!")
        .setColor(0xFF0000)
        .setDescription(
          byId
            ? `<@${blEntry.discordId}> jest na **blackliście serwera** i złożył(a) ticket rekrutacyjny!`
            : `Gracz \`${blEntry.nick}\` jest na **blackliście** i mógł złożyć ticket rekrutacyjny!`
        )
        .addFields(
          { name: "Nick MC", value: `\`${blEntry.nick}\``, inline: true },
          { name: "Discord", value: `<@${blEntry.discordId}>`, inline: true },
          { name: "Powód", value: blEntry.reason ?? "Nie podano", inline: false },
        )
        .setFooter({ text: byId ? "PackSMP Blacklist System" : "PackSMP Blacklist System • wykryto po nazwie kanału" })
        .setTimestamp();
      await channel.send({ content: "@here", embeds: [warnEmbed] });
      try {
        const blCh = await client!.channels.fetch(BLACKLIST_CHANNEL_ID);
        if (blCh?.isTextBased())
          await (blCh as TextChannel).send({ content: `⛔ Osoba z blacklisty otworzyła ticket: ${channel.toString()}`, embeds: [warnEmbed] });
      } catch { /* ignore */ }
    };

    let blacklisted = false;
    for (const uid of mentioned) {
      const hit = blacklist.find(e => e.discordId === uid);
      if (hit) { await sendBlWarn(hit, true); blacklisted = true; break; }
    }
    if (!blacklisted) {
      for (const part of nameParts) {
        if (part.length < 2) continue;
        const hit = blacklist.find(e => e.nick.toLowerCase() === part.toLowerCase());
        if (hit) { await sendBlWarn(hit, false); break; }
      }
    }
  }

  // ── Admin panel ─────────────────────────────────────────────────────────────
  const adminLabels: Record<TicketType, { accept: string; reject: string }> = {
    rekrutacja: { accept: "✅ Akceptuj rekrutację", reject: "❌ Odrzuć" },
    sojusz:     { accept: "✅ Zaakceptuj sojusz",   reject: "❌ Odrzuć" },
    konkurs:    { accept: "✅ Potwierdź wygraną",   reject: "❌ Odrzuć" },
    walka:      { accept: "✅ Zatwierdź walkę",     reject: "❌ Odrzuć" },
  };
  const lbl = adminLabels[ticketType];

  const adminEmbed = new EmbedBuilder()
    .setTitle("🛡️ Panel administracyjny")
    .setColor(0xFEE75C)
    .setDescription(
      `**Typ:** ${form.title}\n` +
      `**Zgłaszający:** ${userId ? `<@${userId}>` : "*(nieznany)*"}`
    )
    .setFooter({ text: "PackSMP Admin Panel" })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ra:${ticketType}:${safeUid}`).setLabel(lbl.accept).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`rr:${ticketType}:${safeUid}`).setLabel(lbl.reject).setStyle(ButtonStyle.Danger),
  );

  await channel.send({ embeds: [adminEmbed], components: [row] });
  logger.info({ channelId: channel.id, ticketType, userId }, "Ticket admin panel sent");
}

function isAdmin(message: Message): boolean {
  if (!message.member) return false;
  return message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    message.member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

function hasRecruiterAccess(message: Message): boolean {
  return isAdmin(message) || Boolean(message.member?.roles.cache.has(RECRUIT_ROLE_ID));
}

function isModerator(message: Message): boolean {
  if (!message.member) return false;
  return isAdmin(message) || message.member.roles.cache.has(MODERATOR_ROLE_ID);
}

// ─────────────────────────────────────────────────────────────────────────────
// REJESTRY KOMEND — dodaj tutaj nową komendę, reszta aktualizuje się sama
// ─────────────────────────────────────────────────────────────────────────────

type CmdEntry = { name: string; desc: string };
type CmdSection = { header: string; emoji: string; cmds: CmdEntry[] };

export const PLAYER_CMD_REGISTRY: CmdSection[] = [
  {
    emoji: "🔍", header: "Informacje",
    cmds: [
      { name: "=help / =pomoc",               desc: "Ta lista komend" },
      { name: "=helpAllCommands",             desc: "Pełna lista wszystkich komend Discord i Minecraft" },
      { name: "=status",                       desc: "Status systemu MC↔DC (Discord, MC bot, sync)" },
      { name: "=gracze",                       desc: "Lista graczy aktualnie online na serwerze MC" },
      { name: "=ping",                         desc: "Opóźnienie bota Discord" },
      { name: "=smp-panel",                    desc: "Wysyła panel do otrzymania/usunięcia rangi SMP" },
      { name: "=zweryfikowani [strona]",       desc: "Lista zweryfikowanych kont MC↔Discord" },
      { name: "=info <nick_mc>",               desc: "Sprawdź info o graczu i jego weryfikację" },
    ],
  },
  {
    emoji: "🔐", header: "Weryfikacja",
    cmds: [
      { name: "=weryfikacja",                  desc: "Sprawdź status weryfikacji swojego konta" },
      { name: "=weryfikacja-usun",             desc: "Odłącz swoje konto MC od Discorda" },
    ],
  },
  {
    emoji: "🎫", header: "Tickety",
    cmds: [
      { name: "=rekruter",                     desc: "Dodaje rangę rekruterów do bieżącego ticketu" },
    ],
  },
];

export const ADMIN_CMD_REGISTRY: CmdSection[] = [
  {
    emoji: "🎫", header: "Tickety",
    cmds: [
      { name: "=formularz [typ]", desc: "Wysyła formularz do bieżącego kanału ticketu (typ: rekrutacja/sojusz/konkurs/walka). Jeśli typ pominięty — auto-wykrywa z nazwy kanału." },
      { name: "=wynik-formularz / =formularz-wyniki", desc: "Wysyła formularz do publikowania wyniku rekrutacji (rekruterzy/admini)" },
      { name: "=wynik-test-formularz", desc: "Wysyła przykładowy testowy wynik rekrutacji do podglądu wyglądu (alias: =wynik-test-ftomularz)" },
      { name: "=wstrzymaj-ticket [powód]", desc: "Oznacza ticket jako wstrzymany i publikuje powód w kanale" },
    ],
  },
  {
    emoji: "📋", header: "Weryfikacja",
    cmds: [
      { name: "=weryfikacja-reczna @user <nick>",        desc: "✏️ Ręcznie weryfikuje użytkownika z podanym nickiem MC (moderator+)" },
      { name: "=zmien-nick @user <nick>",                desc: "✏️ Zmienia nick MC zweryfikowanego użytkownika (moderator+)" },
      { name: "=weryfikacja-test [@user]",               desc: "Test systemu weryfikacji" },
      { name: "=weryfikacja-panel",                      desc: "Tworzy panel weryfikacji z przyciskami na kanale" },
      { name: "=weryfikacja-sprawdz @user",              desc: "Sprawdza status weryfikacji użytkownika" },
      { name: "=admin-usun-weryfikacje @user",           desc: "Usuwa weryfikację użytkownika (reset)" },
    ],
  },
  {
    emoji: "🔄", header: "Synchronizacja",
    cmds: [
      { name: "=sync-status",                            desc: "Szczegółowy status synchronizacji czatu" },
      { name: "=sync-restart",                           desc: "Wznawia synchronizację czatu" },
      { name: "=maintenance [on/off]",                   desc: "Włącza/wyłącza tryb konserwacji" },
    ],
  },
  {
    emoji: "🤖", header: "Bot",
    cmds: [
      { name: "=bot-status",                             desc: "Status i szczegóły bota Minecraft" },
      { name: "=reconnect",                              desc: "Wymusza ponowne połączenie bota MC" },
      { name: "=oglos <wiadomość>",                      desc: "Wysyła ogłoszenie na czat serwera MC" },
    ],
  },
  {
    emoji: "📊", header: "Informacje i logi",
    cmds: [
      { name: "=logi [n]",                               desc: "Ostatnie n logów systemowych (domyślnie 10)" },
      { name: "=historia [n]",                           desc: "Ostatnie n wiadomości z czatu MC↔DC (max 30)" },
      { name: "=config",                                 desc: "Aktualna konfiguracja systemu" },
      { name: "=wyczysc",                                desc: "Usuwa dostarczone wiadomości z bazy danych" },
    ],
  },
  {
    emoji: "🚫", header: "Blacklista",
    cmds: [
      { name: "=blacklista",                             desc: "Wyświetla aktualną blacklistę" },
      { name: "=blacklista-przyklad",                           desc: "Pokazuje przykłady użycia komend blacklisty" },
      { name: "=blacklista-zresetuj",                          desc: "⚠️ Czyści całą blacklistę (nieodwracalne)" },
      { name: "=blacklista-dodaj <id> <@nick> <powód> <nick_mc>", desc: "Dodaje osobę do blacklisty" },
      { name: "=blacklista-usun <nick>",                 desc: "Usuwa osobę z blacklisty" },
    ],
  },
  {
    emoji: "⚔️", header: "Moderacja (wymaga OP bota)",
    cmds: [
      { name: "=kick <nick> [powód]",                    desc: "Kickuje gracza z serwera Minecraft" },
      { name: "=ban <nick> [powód]",                     desc: "Banuje gracza na serwerze Minecraft" },
      { name: "=whitelist dodaj/usun <nick>",            desc: "Dodaje lub usuwa gracza z whitelisty" },
    ],
  },
];

const MC_CMD_REGISTRY: CmdSection[] = [
  {
    emoji: "⛏️", header: "Komendy Minecraft (przez /msg do bota)",
    cmds: [
      { name: "=pomoc",                    desc: "Pokazuje komendy dostępne w Minecraft" },
      { name: "=status",                   desc: "Pokazuje status systemu i bota MC" },
      { name: "=weryfikacja",              desc: "Sprawdza status weryfikacji konta" },
      { name: "=verify <kod>",             desc: "Weryfikuje konto Minecraft kodem z Discorda" },
      { name: "=zweryfikujkontodc <kod>",  desc: "Alias komendy =verify" },
      { name: "=msg <nick/id> <wiadomość>", desc: "Wysyła prywatną wiadomość" },
    ],
  },
];

const SMP_ROLE_CMD_SECTION: CmdSection = {
  emoji: "🎮", header: "Ranga SMP",
  cmds: [
    { name: "=smp / =smp-panel",          desc: "Wysyła panel otrzymania/usunięcia rangi SMP" },
    { name: "=chcerangesmp",              desc: "Nadaje rangę SMP na kanale rangi SMP" },
    { name: "=niechcerangismp",           desc: "Usuwa rangę SMP na kanale rangi SMP" },
  ],
};

export const ALL_CMD_REGISTRY: CmdSection[] = [
  ...PLAYER_CMD_REGISTRY,
  ...ADMIN_CMD_REGISTRY,
  SMP_ROLE_CMD_SECTION,
  ...MC_CMD_REGISTRY,
];

function buildFields(registry: CmdSection[]) {
  // One field per section — avoids Discord's 25-field embed limit
  return registry.map(section => ({
    name: `${section.emoji} ${section.header}`,
    value: section.cmds.map(c => `\`${c.name}\` — ${c.desc}`).join("\n"),
    inline: false,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleDiscordCommand(message: Message, cmd: string, args: string[]): Promise<void> {
  switch (cmd) {
    // ── Aliases ──────────────────────────────────────────────────────
    case "help":
    // ── Player commands ──────────────────────────────────────────────
    case "pomoc": {
      const embed = new EmbedBuilder()
        .setTitle("📖 PackSMP — Komendy Discord")
        .setColor(0x5865F2)
        .addFields(...buildFields(PLAYER_CMD_REGISTRY))
        .setFooter({ text: "PackSMP • Admini: wpisz =help_admincmds" });
      await message.reply({ embeds: [embed] });
      break;
    }

    case "helpallcommands": {
      const embed = new EmbedBuilder()
        .setTitle("📚 PackSMP — Wszystkie komendy")
        .setDescription(
          "Pełna lista komend dostępnych w bocie. " +
          "Komendy oznaczone jako administracyjne wymagają odpowiednich uprawnień."
        )
        .setColor(0x5865F2)
        .addFields(...buildFields(ALL_CMD_REGISTRY))
        .setFooter({ text: "PackSMP • Komenda: =helpAllCommands" })
        .setTimestamp();
      await message.reply({ embeds: [embed] });
      break;
    }

    case "rekruter": {
      if (!message.guild || message.channel.isDMBased()) return;

      const channel = message.channel as TextChannel;
      const ticket = await detectTicketChannel(channel);
      if (!ticket) {
        await message.reply("❌ Tej komendy można użyć tylko na kanale ticketu.");
        return;
      }

      const botMember = message.guild.members.me ?? await message.guild.members.fetchMe();
      if (!botMember.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        await message.reply("❌ Bot nie ma uprawnienia **Zarządzanie kanałami**.");
        return;
      }

      const role = await message.guild.roles.fetch(RECRUIT_ROLE_ID);
      if (!role) {
        await message.reply(`❌ Nie znaleziono rangi rekruterów o ID \`${RECRUIT_ROLE_ID}\`.`);
        return;
      }

      try {
        await channel.permissionOverwrites.edit(role, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true,
        }, { reason: `Komenda =rekruter użyta przez ${message.author.tag}` });

        await message.reply(
          `✅ Dodano dostęp rangi ${role} do tego ticketu.\n` +
          `Każda osoba posiadająca tę rangę może teraz wejść i pisać na kanale.`
        );
      } catch (err) {
        logger.warn({ err: String(err), channelId: channel.id, roleId: RECRUIT_ROLE_ID }, "Failed to grant recruiter ticket access");
        await message.reply("❌ Nie udało się dodać rangi rekruterów do ticketu. Sprawdź uprawnienia bota.");
      }
      break;
    }

    case "wynik-formularz":
    case "formularz-wyniki": {
      if (!hasRecruiterAccess(message)) {
        await message.reply("❌ Ta komenda jest dostępna tylko dla rekruterów i administracji.");
        return;
      }
      if (message.channel.isDMBased()) return;

      const channel = message.channel as TextChannel;
      const pageButtons = RESULT_FORM_PAGES.map((_, pageIndex) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`wynik_form_page:${pageIndex}`)
            .setLabel(`📝 Wynik rekrutacji — strona ${pageIndex + 1}/${RESULT_FORM_PAGES.length}`)
            .setStyle(ButtonStyle.Primary),
        )
      );

      const panelEmbed = new EmbedBuilder()
        .setTitle("📝 Formularz wyniku rekrutacji")
        .setColor(0x5865F2)
        .setDescription(
          "Wypełnij formularz, aby opublikować wynik rekrutacji w czytelnej formie.\n\n" +
          "Uzupełnij obie strony, a bot wyśle gotowy embed na ten kanał."
        )
        .setFooter({ text: "PackSMP • Wyniki rekrutacji" })
        .setTimestamp();

      await channel.send({ embeds: [panelEmbed], components: pageButtons });
      await message.reply("✅ Formularz wyniku rekrutacji został wysłany.");
      break;
    }

    case "wstrzymaj-ticket": {
      if (!hasRecruiterAccess(message)) {
        await message.reply("❌ Ta komenda jest dostępna tylko dla rekruterów i administracji.");
        return;
      }
      if (!message.guild || message.channel.isDMBased()) return;

      const channel = message.channel as TextChannel;
      const ticket = await detectTicketChannel(channel);
      if (!ticket) {
        await message.reply("❌ Tej komendy można użyć tylko na kanale ticketu.");
        return;
      }

      const reason = args.join(" ").trim() || "przemyślenie dotyczące rekrutacji";
      const guildIcon = message.guild.iconURL({ extension: "png", size: 256 });
      const ticketOwner = ticket.userId ? `<@${ticket.userId}>` : "Zgłaszający";
      const holdEmbed = new EmbedBuilder()
        .setAuthor({ name: "PackSMP • Status ticketu" })
        .setTitle("⏸️ Ticket wstrzymany")
        .setColor(0xFEE75C)
        .setDescription(
          `${ticketOwner}\n\n` +
          `Ten ticket został **wstrzymany** przez administrację.\n\n` +
          `**📌 Powód wstrzymania:**\n${reason.slice(0, 1500)}\n\n` +
          `⏳ Oczekuje na dalszą decyzję administracji.`
        )
        .addFields({
          name: "👤 Wstrzymał:",
          value: message.member?.displayName ?? message.author.username,
          inline: true,
        })
        .setFooter({ text: "PackSMP • Ticket wstrzymany" })
        .setTimestamp();

      if (guildIcon) holdEmbed.setThumbnail(guildIcon);

      await channel.send({
        content: ticket.userId ? `<@${ticket.userId}>` : "⏸️",
        embeds: [holdEmbed],
        allowedMentions: ticket.userId ? { users: [ticket.userId] } : { parse: [] },
      });
      await message.reply("✅ Ticket został oznaczony jako wstrzymany.");
      break;
    }

    case "wynik-test-formularz":
    case "wynik-test-ftomularz": {
      if (!hasRecruiterAccess(message)) {
        await message.reply("❌ Ta komenda jest dostępna tylko dla rekruterów i administracji.");
        return;
      }
      if (message.channel.isDMBased()) return;

      const guildIcon = message.guild?.iconURL({ extension: "png", size: 256 });
      const testEmbed = buildRecruitmentResultEmbed(TEST_RESULT_ANSWERS, true, guildIcon);
      await (message.channel as TextChannel).send({
        content: "🧪 **TESTOWY WYNIK REKRUTACJI — to nie jest prawdziwe podanie**",
        embeds: [testEmbed],
        allowedMentions: { parse: [] },
      });
      await message.reply("✅ Wysłano testowy wynik rekrutacji.");
      break;
    }

    case "weryfikacja": {
      const status = await getVerificationStatusByDiscord(message.author.id);
      const embed = new EmbedBuilder()
        .setTitle("🔐 Status weryfikacji")
        .setColor(status?.isVerified ? 0x57F287 : 0xED4245)
        .addFields(
          { name: "Status", value: status?.isVerified ? "✅ Zweryfikowane" : "❌ Niezweryfikowane", inline: true },
          { name: "Konto Minecraft", value: status?.mcNick ?? "Brak", inline: true },
          { name: "Data weryfikacji", value: status?.verifiedAt?.toLocaleDateString("pl-PL") ?? "—", inline: true },
        )
        .setFooter({ text: status?.isVerified ? "Użyj =weryfikacja-usun aby odłączyć konto" : "Kliknij 🔐 Zweryfikuj konto w panelu weryfikacji" });
      await message.reply({ embeds: [embed] });
      break;
    }

    case "weryfikacja-test": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const target = message.mentions.users.first() ?? message.author;
      const status = await getVerificationStatusByDiscord(target.id);
      const testEmbed = new EmbedBuilder()
        .setTitle("🧪 Test systemu weryfikacji")
        .setColor(0xFEE75C)
        .addFields(
          { name: "Testowany użytkownik", value: `<@${target.id}>`, inline: true },
          { name: "Status weryfikacji", value: status?.isVerified ? "✅ Zweryfikowany" : "❌ Niezweryfikowany", inline: true },
          { name: "Nick MC", value: status?.mcNick ? `\`${status.mcNick}\`` : "—", inline: true },
          { name: "Bot Discord", value: `✅ Online — \`${client!.user?.tag}\``, inline: false },
          { name: "Chat Channel", value: CHAT_CHANNEL_ID ? `<#${CHAT_CHANNEL_ID}>` : "❌ Nieskonfigurowany", inline: true },
          { name: "Verify Role", value: VERIFY_ROLE_ID ? `<@&${VERIFY_ROLE_ID}>` : "❌ Nieskonfigurowana", inline: true },
        )
        .setDescription("To jest wiadomość testowa — system weryfikacji działa poprawnie.")
        .setFooter({ text: "PackSMP Verification System • TEST" })
        .setTimestamp();
      await message.reply({ embeds: [testEmbed] });
      break;
    }

    case "weryfikacja-usun": {
      const status = await getVerificationStatusByDiscord(message.author.id);
      if (!status?.isVerified) {
        await message.reply("❌ Twoje konto nie jest zweryfikowane.");
        return;
      }
      await unlinkAccount(message.author.id);
      // Remove role
      try {
        const guild = client?.guilds.cache.get(GUILD_ID);
        const member = guild?.members.cache.get(message.author.id) ?? await guild?.members.fetch(message.author.id);
        if (member && VERIFY_ROLE_ID) {
          await member.roles.remove(VERIFY_ROLE_ID);
        }
      } catch { /* ignore */ }
      await message.reply("✅ Konto zostało odłączone. Możesz zweryfikować się ponownie.");
      break;
    }

    case "gracze": {
      const players = getOnlinePlayers();
      const embed = new EmbedBuilder()
        .setTitle("⛏️ Gracze na serwerze MC")
        .setColor(0x57F287)
        .setDescription(
          players.length > 0
            ? players.map(p => `• \`${p}\``).join("\n")
            : "Brak graczy online"
        )
        .setFooter({ text: `Łącznie: ${players.length}` })
        .setTimestamp();
      await message.reply({ embeds: [embed] });
      break;
    }

    case "ping": {
      const start = Date.now();
      const sent = await message.reply("🏓 Sprawdzam...");
      const latency = Date.now() - start;
      await sent.edit(`🏓 Pong! Bot: **${latency}ms** | Discord API: **${client!.ws.ping}ms**`);
      break;
    }

    case "zweryfikowani": {
      const page = Math.max(1, parseInt(args[0] ?? "1", 10) || 1);
      const limit = 10;
      const offset = (page - 1) * limit;
      const verified = await db
        .select()
        .from(verifiedUsersTable)
        .where(eq(verifiedUsersTable.isVerified, true))
        .limit(limit + 1)
        .offset(offset);
      const hasMore = verified.length > limit;
      const rows = verified.slice(0, limit);
      const embed = new EmbedBuilder()
        .setTitle(`✅ Zweryfikowane konta — strona ${page}`)
        .setColor(0x57F287)
        .setDescription(
          rows.length === 0
            ? "Brak zweryfikowanych kont."
            : rows.map(u => `\`${u.mcNick}\` ↔ <@${u.discordId}>`).join("\n")
        )
        .setFooter({
          text: hasMore
            ? `Strona ${page} • więcej: =zweryfikowani ${page + 1}`
            : `Strona ${page} • koniec listy`,
        });
      await message.reply({ embeds: [embed] });
      break;
    }

    case "info": {
      const nick = args[0];
      if (!nick) {
        await message.reply("❌ Użycie: `=info <nick_minecraft>`");
        return;
      }
      const status = await getVerificationStatusByMcNick(nick);
      const embed = new EmbedBuilder()
        .setTitle(`🔍 Info o graczu: ${nick}`)
        .setColor(status?.isVerified ? 0x57F287 : 0xED4245)
        .addFields(
          { name: "Status", value: status?.isVerified ? "✅ Zweryfikowany" : "❌ Niezweryfikowany", inline: true },
          { name: "Discord", value: status?.discordId ? `<@${status.discordId}>` : "—", inline: true },
          { name: "Data weryfikacji", value: status?.verifiedAt ? status.verifiedAt.toLocaleDateString("pl-PL") : "—", inline: true },
        )
        .setFooter({ text: "PackSMP Verification System" });
      await message.reply({ embeds: [embed] });
      break;
    }

    case "status": {
      const mcStatus = getMcBotStatus();
      const rconStatus = getRconStatus();
      const embed = new EmbedBuilder()
        .setTitle("📊 Status systemu PackSMP")
        .setColor(0x5865F2)
        .addFields(
          { name: "🤖 Discord Bot", value: isReady ? "✅ Online" : "❌ Offline", inline: true },
          { name: "⛏️ MC Bot", value: mcStatus.connected ? `✅ Online (${mcStatus.username})` : "❌ Offline", inline: true },
          { name: "🔌 RCON", value: rconStatus.connected ? "✅ Połączony" : "❌ Rozłączony", inline: true },
          { name: "🔄 Synchronizacja", value: bridgeService.isSyncEnabled() ? "✅ Aktywna" : "❌ Wyłączona", inline: true },
          { name: "🔧 Tryb konserwacji", value: bridgeService.isMaintenanceMode() ? "✅ Aktywny" : "—", inline: true },
        )
        .setTimestamp();
      await message.reply({ embeds: [embed] });
      break;
    }

    // ── Admin commands ───────────────────────────────────────────────
    case "help_admincmds":
    case "pomocadminpanel": {
      if (!isAdmin(message)) {
        await message.reply("❌ Brak uprawnień.");
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle("🛡️ PackSMP — Komendy Administracyjne")
        .setColor(0xFEE75C)
        .addFields(...buildFields(ADMIN_CMD_REGISTRY))
        .setFooter({ text: "PackSMP • Tylko dla administratorów serwera" });
      await message.reply({ embeds: [embed] });
      break;
    }

    case "weryfikacja-panel": {
      if (!isAdmin(message)) {
        await message.reply("❌ Brak uprawnień.");
        return;
      }
      await createVerificationPanel(message.channel as TextChannel);
      await message.delete().catch(() => {});
      break;
    }

    case "weryfikacja-reczna": {
      if (!isModerator(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const targetId = args[0]?.replace(/[<@!>]/g, "");
      const nick = args[1];
      if (!targetId || !nick) {
        await message.reply("❌ Użycie: `=weryfikacja-reczna @user <nick_minecraft>`");
        return;
      }
      // Block if another user already uses that MC nick
      const existing = await getVerificationStatusByMcNick(nick);
      if (existing && existing.discordId !== targetId) {
        await message.reply(`❌ Nick \`${nick}\` jest już powiązany z innym kontem Discord.`);
        return;
      }
      await manualVerify(targetId, nick);
      // Assign verify role
      const guild = client?.guilds.cache.get(GUILD_ID);
      const member = guild ? await guild.members.fetch(targetId).catch(() => null) : null;
      if (member && VERIFY_ROLE_ID) await member.roles.add(VERIFY_ROLE_ID).catch(() => {});
      await message.reply(
        `✅ Użytkownik <@${targetId}> został ręcznie zweryfikowany.\n` +
        `🎮 Nick Minecraft: \`${nick}\`` +
        (member && VERIFY_ROLE_ID ? `\n🏷️ Nadano rolę <@&${VERIFY_ROLE_ID}>` : "")
      );
      break;
    }

    case "zmien-nick": {
      if (!isModerator(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const targetId = args[0]?.replace(/[<@!>]/g, "");
      const nick = args[1];
      if (!targetId || !nick) {
        await message.reply("❌ Użycie: `=zmien-nick @user <nowy_nick_minecraft>`");
        return;
      }
      // Block if another user already uses that MC nick
      const existing = await getVerificationStatusByMcNick(nick);
      if (existing && existing.discordId !== targetId) {
        await message.reply(`❌ Nick \`${nick}\` jest już powiązany z innym kontem Discord.`);
        return;
      }
      const current = await getVerificationStatusByDiscord(targetId);
      const changed = await changeNick(targetId, nick);
      if (!changed) {
        await message.reply(`❌ Użytkownik <@${targetId}> nie jest zweryfikowany. Użyj najpierw \`=weryfikacja-reczna\`.`);
        return;
      }
      await message.reply(
        `✅ Nick Minecraft użytkownika <@${targetId}> zmieniony.\n` +
        `🎮 Poprzedni: \`${current?.mcNick ?? "brak"}\` → Nowy: \`${nick}\``
      );
      break;
    }

    case "weryfikacja-sprawdz": {
      if (!isAdmin(message)) {
        await message.reply("❌ Brak uprawnień.");
        return;
      }
      const userId = args[0]?.replace(/[<@!>]/g, "");
      if (!userId) {
        await message.reply("❌ Użycie: `=weryfikacja-sprawdz @user`");
        return;
      }
      const status = await getVerificationStatusByDiscord(userId);
      const embed = new EmbedBuilder()
        .setTitle("🔍 Status weryfikacji")
        .setColor(status?.isVerified ? 0x57F287 : 0xED4245)
        .addFields(
          { name: "Discord ID", value: userId, inline: true },
          { name: "Status", value: status?.isVerified ? "✅ Zweryfikowany" : "❌ Niezweryfikowany", inline: true },
          { name: "Nick MC", value: status?.mcNick ?? "Brak", inline: true },
          { name: "Data", value: status?.verifiedAt?.toLocaleDateString("pl-PL") ?? "—", inline: true },
        );
      await message.reply({ embeds: [embed] });
      break;
    }

    case "admin-usun-weryfikacje": {
      if (!isAdmin(message)) {
        await message.reply("❌ Brak uprawnień.");
        return;
      }
      const userId = args[0]?.replace(/[<@!>]/g, "");
      if (!userId) {
        await message.reply("❌ Użycie: `=admin-usun-weryfikacje @user`");
        return;
      }
      const unlinked = await unlinkAccount(userId);
      if (!unlinked) {
        await message.reply("❌ Użytkownik nie ma powiązanego konta.");
        return;
      }
      try {
        const guild = client?.guilds.cache.get(GUILD_ID);
        const member = guild?.members.cache.get(userId) ?? await guild?.members.fetch(userId).catch(() => null);
        if (member && VERIFY_ROLE_ID) await member.roles.remove(VERIFY_ROLE_ID);
      } catch { /* ignore */ }
      await message.reply(`✅ Weryfikacja użytkownika <@${userId}> usunięta.`);
      break;
    }

    case "sync-status": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const mcStatus = getMcBotStatus();
      const rcon = getRconStatus();
      const embed = new EmbedBuilder()
        .setTitle("🔄 Status synchronizacji")
        .setColor(0x5865F2)
        .addFields(
          { name: "MC Bot", value: `${mcStatus.connected ? "✅" : "❌"} ${mcStatus.host}:${mcStatus.port}`, inline: false },
          { name: "RCON", value: `${rcon.connected ? "✅" : "❌"} ${rcon.host}:${rcon.port}`, inline: false },
          { name: "Sync", value: bridgeService.isSyncEnabled() ? "✅ Aktywna" : "❌ Wyłączona", inline: false },
          { name: "Maintenance", value: bridgeService.isMaintenanceMode() ? "✅ Tak" : "❌ Nie", inline: false },
        );
      await message.reply({ embeds: [embed] });
      break;
    }

    case "sync-restart": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      bridgeService.setSyncEnabled(true);
      await message.reply("✅ Synchronizacja zrestartowana.");
      break;
    }

    case "bot-status": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const s = getMcBotStatus();
      await message.reply(`MC Bot: **${s.connected ? "✅ Online" : "❌ Offline"}** | Nick: \`${s.username}\` | ${s.host}:${s.port}`);
      break;
    }

    case "logi": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const limit = Math.min(parseInt(args[0] ?? "10", 10) || 10, 25);
      const logs = await getRecentLogs(limit);
      if (logs.length === 0) {
        await message.reply("Brak logów.");
        return;
      }
      const text = logs.map(l => `[${l.level.toUpperCase()}][${l.service}] ${l.message}`).join("\n").slice(0, 1900);
      await message.reply(`\`\`\`\n${text}\n\`\`\``);
      break;
    }

    case "config": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const embed = new EmbedBuilder()
        .setTitle("⚙️ Konfiguracja systemu")
        .setColor(0x5865F2)
        .addFields(
          { name: "MC Host", value: process.env["MC_HOST"] ?? "—", inline: true },
          { name: "MC Port", value: process.env["MC_PORT"] ?? "—", inline: true },
          { name: "Bot Nick", value: process.env["MC_BOT_NICK"] ?? "—", inline: true },
          { name: "Chat Channel", value: `<#${CHAT_CHANNEL_ID}>`, inline: true },
          { name: "Verify Role", value: `<@&${VERIFY_ROLE_ID}>`, inline: true },
          { name: "Sync Enabled", value: bridgeService.isSyncEnabled() ? "✅" : "❌", inline: true },
        );
      await message.reply({ embeds: [embed] });
      break;
    }

    case "maintenance": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const arg = args[0]?.toLowerCase();
      const enable = arg === "on" || (arg !== "off" && !bridgeService.isMaintenanceMode());
      bridgeService.setMaintenance(enable);
      bridgeService.setSyncEnabled(!enable);
      await message.reply(`🔧 Tryb konserwacji: **${enable ? "WŁĄCZONY" : "WYŁĄCZONY"}**. Synchronizacja: **${bridgeService.isSyncEnabled() ? "aktywna" : "wstrzymana"}**.`);
      break;
    }

    case "oglos": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const text = args.join(" ");
      if (!text) { await message.reply("❌ Użycie: `=oglos <wiadomość>`"); return; }
      const sent = await sendChatMessage(`[Ogłoszenie] ${text}`);
      await message.reply(sent ? `📢 Ogłoszenie wysłane na serwer MC.` : "❌ Bot MC jest offline — nie można wysłać ogłoszenia.");
      break;
    }

    case "reconnect": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      await message.reply("🔄 Restartuję połączenie bota MC...");
      restartMinecraft();
      break;
    }

    case "wyczysc": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const { clearDeliveredMessages } = await import("./privmsg.js");
      const count = await clearDeliveredMessages();
      await message.reply(`🗑️ Usunięto **${count}** dostarczonych wiadomości z bazy.`);
      break;
    }

    case "blacklista": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const { getBlacklist } = await import("./blacklist.js");
      const entries = await getBlacklist();
      const embed = new EmbedBuilder()
        .setTitle("🚫 Blacklista PackSMP")
        .setColor(0xED4245)
        .setDescription(
          entries.length === 0
            ? "Blacklista jest pusta."
            : entries.map((e, i) =>
                `**${i + 1}.** \`${e.nick}\` | <@${e.discordId}>${e.reason ? ` — ${e.reason}` : ""}`
              ).join("\n")
        )
        .setFooter({ text: `${entries.length} ${entries.length === 1 ? "osoba" : "osób"} na blackliście` })
        .setTimestamp();
      await message.reply({ embeds: [embed] });
      break;
    }

    case "blacklista-zresetuj": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const { clearBlacklist, getBlacklist } = await import("./blacklist.js");
      const before = await getBlacklist();
      await clearBlacklist();
      try {
        const blCh = await client!.channels.fetch(BLACKLIST_CHANNEL_ID);
        if (blCh?.isTextBased()) {
          await (blCh as any).send(
            `🗑️ **Blacklista została wyczyszczona** przez ${message.member?.displayName ?? message.author.username} — usunięto ${before.length} ${before.length === 1 ? "wpis" : "wpisów"}.`
          );
        }
      } catch { /* ignore */ }
      await message.reply(`✅ Blacklista wyczyszczona. Usunięto **${before.length}** ${before.length === 1 ? "wpis" : "wpisów"}.`);
      break;
    }

    case "blacklista-przyklad": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const embed = new EmbedBuilder()
        .setTitle("📋 Przykłady użycia blacklisty")
        .setColor(0xFEE75C)
        .addFields(
          {
            name: "➕ Dodanie do blacklisty",
            value:
              "```\n=blacklista-dodaj <discord_id> <@discord_nick> <powód> <nick_mc>\n```" +
              "**Przykład:**\n```\n=blacklista-dodaj 1330791376270659596 @stefan00_00 cheating na serwerze StefanMC\n```",
            inline: false,
          },
          {
            name: "➖ Usunięcie z blacklisty",
            value:
              "```\n=blacklista-usun <nick_mc>\n```" +
              "**Przykład:**\n```\n=blacklista-usun StefanMC\n```",
            inline: false,
          },
          {
            name: "📃 Wyświetlenie blacklisty",
            value: "```\n=blacklista\n```",
            inline: false,
          },
          {
            name: "ℹ️ Uwagi",
            value:
              "• `discord_id` — numeryczne ID użytkownika (prawy klik → Kopiuj ID)\n" +
              "• `@discord_nick` — wzmianka użytkownika\n" +
              "• `powód` — może zawierać spacje\n" +
              "• `nick_mc` — nick Minecraft, **musi być ostatnim argumentem**",
            inline: false,
          },
        )
        .setFooter({ text: "PackSMP • Blacklista" });
      await message.reply({ embeds: [embed] });
      break;
    }

    case "blacklista-dodaj": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      // Format: =blacklista-dodaj <discord_id> <@discord_nick> <powód> <nick_mc>
      // args[0] = discord ID (raw number lub @mention)
      // args[1] = @discord_tag (dla czytelności, ignorowane poza wyświetlaniem)
      // args[2..n-1] = powód
      // args[n] = nick minecraft (ostatni argument)
      const targetId = args[0]?.replace(/[<@!>]/g, "");
      const remaining = args.slice(2); // pomijamy discord tag
      const mcNick = remaining[remaining.length - 1];
      const reason = remaining.slice(0, -1).join(" ") || undefined;
      if (!targetId || !mcNick) {
        await message.reply("❌ Użycie: `=blacklista-dodaj <discord_id> <@discord_nick> <powód> <nick_mc>`");
        return;
      }
      const { addToBlacklist } = await import("./blacklist.js");
      const addedBy = message.member?.displayName ?? message.author.username;
      const result = await addToBlacklist(mcNick, targetId, addedBy, reason);
      if (!result.success) {
        await message.reply(`❌ ${result.error}`);
        return;
      }
      // Powiadom na kanale blacklisty
      try {
        const blCh = await client!.channels.fetch(BLACKLIST_CHANNEL_ID);
        if (blCh?.isTextBased()) {
          const notifEmbed = new EmbedBuilder()
            .setTitle("🚫 Nowa osoba na blackliście")
            .setColor(0xED4245)
            .addFields(
              { name: "Nick MC", value: `\`${mcNick}\``, inline: true },
              { name: "Discord", value: `<@${targetId}>`, inline: true },
              { name: "Dodał", value: addedBy, inline: true },
              { name: "Powód", value: reason ?? "Nie podano", inline: false },
            )
            .setTimestamp();
          await (blCh as any).send({ embeds: [notifEmbed] });
        }
      } catch { /* ignore */ }
      await message.reply(`✅ \`${mcNick}\` (<@${targetId}>) dodany do blacklisty.`);
      break;
    }

    case "blacklista-usun": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const nick = args[0];
      if (!nick) {
        await message.reply("❌ Użycie: `=blacklista-usun <nick>`");
        return;
      }
      const { removeFromBlacklist, getBlacklist } = await import("./blacklist.js");
      // Pobierz wpis przed usunięciem (żeby mieć discordId do powiadomienia)
      const entries = await getBlacklist();
      const entry = entries.find(e => e.nick.toLowerCase() === nick.toLowerCase());
      const removed = await removeFromBlacklist(nick);
      if (!removed) {
        await message.reply(`❌ Nie znaleziono \`${nick}\` na blackliście.`);
        return;
      }
      // Powiadom na kanale blacklisty
      try {
        const blCh = await client!.channels.fetch(BLACKLIST_CHANNEL_ID);
        if (blCh?.isTextBased()) {
          const notifEmbed = new EmbedBuilder()
            .setTitle("✅ Osoba usunięta z blacklisty")
            .setColor(0x57F287)
            .addFields(
              { name: "Nick MC", value: `\`${nick}\``, inline: true },
              { name: "Discord", value: entry ? `<@${entry.discordId}>` : "—", inline: true },
              { name: "Usunął", value: message.member?.displayName ?? message.author.username, inline: true },
            )
            .setTimestamp();
          await (blCh as any).send({ embeds: [notifEmbed] });
        }
      } catch { /* ignore */ }
      await message.reply(`✅ \`${nick}\` usunięty z blacklisty.`);
      break;
    }

    case "historia": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const n = Math.min(parseInt(args[0] ?? "15", 10) || 15, 30);
      const chats = await getRecentChats(n);
      if (chats.length === 0) {
        await message.reply("Brak historii czatu.");
        return;
      }
      const lines = chats.map(c => {
        const src = c.source === "mc" ? "⛏️" : "💬";
        return `${src} **${c.author}**: ${c.message}`;
      }).join("\n").slice(0, 1900);
      await message.reply(`📜 **Ostatnie ${n} wiadomości czatu:**\n${lines}`);
      break;
    }

    case "kick": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const nick = args[0];
      if (!nick) { await message.reply("❌ Użycie: `=kick <nick> [powód]`"); return; }
      const reason = args.slice(1).join(" ") || "Brak powodu";
      const sent = await sendChatMessage(`/kick ${nick} ${reason}`);
      await message.reply(sent
        ? `🔨 Wysłano komendę kick do **${nick}** (powód: ${reason})`
        : "❌ Bot MC offline — nie można wykonać komendy."
      );
      break;
    }

    case "ban": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const nick = args[0];
      if (!nick) { await message.reply("❌ Użycie: `=ban <nick> [powód]`"); return; }
      const reason = args.slice(1).join(" ") || "Banned by admin";
      const sent = await sendChatMessage(`/ban ${nick} ${reason}`);
      await message.reply(sent
        ? `🔨 Wysłano komendę ban dla **${nick}** (powód: ${reason})`
        : "❌ Bot MC offline — nie można wykonać komendy."
      );
      break;
    }

    // ── SMP rola ─────────────────────────────────────────────────────
    case "chcerangesmp": {
      if (message.channel.id !== SMP_ROLE_CHANNEL_ID) return;
      const member = message.member;
      if (!member) return;
      if (member.roles.cache.has(SMP_ROLE_ID)) {
        await message.reply({ content: "✅ Już masz tę rangę!", flags: MessageFlags.Ephemeral as any });
        return;
      }
      try {
        await member.roles.add(SMP_ROLE_ID);
        await message.reply("✅ Otrzymałeś/aś rangę **SMP**!");
      } catch {
        await message.reply("❌ Nie udało się nadać rangi. Sprawdź uprawnienia bota.");
      }
      break;
    }

    case "niechcerangismp": {
      if (message.channel.id !== SMP_ROLE_CHANNEL_ID) return;
      const member = message.member;
      if (!member) return;
      if (!member.roles.cache.has(SMP_ROLE_ID)) {
        await message.reply({ content: "ℹ️ Nie masz tej rangi.", flags: MessageFlags.Ephemeral as any });
        return;
      }
      try {
        await member.roles.remove(SMP_ROLE_ID);
        await message.reply("✅ Usunięto Ci rangę **SMP**.");
      } catch {
        await message.reply("❌ Nie udało się usunąć rangi. Sprawdź uprawnienia bota.");
      }
      break;
    }

    case "formularz": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const ch = message.channel as TextChannel;

      // Resolve ticket type: from argument or auto-detect from channel name
      const argType = args[0]?.toLowerCase();
      const typeMap: Record<string, TicketType> = {
        // rekrutacja
        rekrutacja: "rekrutacja", rekru: "rekrutacja", recruit: "rekrutacja",
        aplikacja: "rekrutacja", aplikuj: "rekrutacja",
        // sojusz
        sojusz: "sojusz", sojusze: "sojusz", sojusznik: "sojusz",
        wasal: "sojusz", alliance: "sojusz",
        // konkurs
        konkurs: "konkurs", nagroda: "konkurs", wygrana: "konkurs",
        // walka
        walka: "walka", klatka: "walka", klatki: "walka",
        wyzwanie: "walka", fight: "walka", pvp: "walka",
      };

      let resolvedType: TicketType | null = argType ? (typeMap[argType] ?? null) : null;

      if (argType && !resolvedType) {
        await message.reply(
          `❌ Nieznany typ formularza: \`${argType}\`\n\n` +
          `**Dostępne typy:**\n` +
          `• \`rekrutacja\` \`recruit\` \`aplikacja\` — formularz rekrutacyjny\n` +
          `• \`sojusz\` \`wasal\` \`alliance\` — formularz sojuszu\n` +
          `• \`konkurs\` \`nagroda\` \`wygrana\` — formularz konkursowy\n` +
          `• \`walka\` \`klatka\` \`klatki\` \`wyzwanie\` — formularz walki klatki\n\n` +
          `Jeśli pominiesz typ, bot wykryje go automatycznie z nazwy kanału.`
        );
        return;
      }

      if (!resolvedType) {
        // Auto-detect from channel name (same logic as ChannelCreate)
        const chanName = ch.name.toLowerCase();
        if (chanName.includes("sojusz") || chanName.includes("wasal") || chanName.includes("alliance")) {
          resolvedType = "sojusz";
        } else if (chanName.includes("konkurs") || chanName.includes("nagroda")) {
          resolvedType = "konkurs";
        } else if (chanName.includes("walka") || chanName.includes("klatka") || chanName.includes("wyzwanie")) {
          resolvedType = "walka";
        } else {
          resolvedType = "rekrutacja"; // default
        }
      }

      // Find ticket opener from permission overwrites
      const mentioned = new Set<string>();
      const overwrites = (ch as any).permissionOverwrites?.cache;
      for (const ow of overwrites?.values?.() ?? []) {
        if (ow.type !== 1) continue;
        try {
          const mem = ch.guild?.members?.cache?.get(ow.id) ?? await ch.guild?.members?.fetch(ow.id);
          if (mem && !mem.user.bot) mentioned.add(mem.id);
        } catch { /* ignore */ }
      }
      // Also scan recent messages for mentions
      try {
        const msgs = await ch.messages.fetch({ limit: 10 });
        for (const msg of msgs.values()) {
          for (const m of msg.content.matchAll(/<@!?(\d+)>/g)) mentioned.add(m[1]!);
          for (const embed of msg.embeds) {
            for (const m of `${embed.description ?? ""} ${embed.fields.map(f => f.value).join(" ")}`.matchAll(/<@!?(\d+)>/g)) mentioned.add(m[1]!);
          }
        }
      } catch { /* ignore */ }

      let userId: string | null = null;
      for (const uid of mentioned) {
        try {
          const u = await client!.users.fetch(uid);
          if (!u.bot) { userId = uid; break; }
        } catch { /* ignore */ }
      }

      await message.reply(`📋 Wysyłam formularz **${resolvedType}** na ten kanał...`);
      await sendTicketFormToChannel(ch, resolvedType, userId, mentioned, ch.name.toLowerCase());
      break;
    }

    case "smp-panel":
    case "smp": {
      const smpEmbed = new EmbedBuilder()
        .setTitle("🎮 Ranga SMP")
        .setColor(0x57F287)
        .setDescription(
          "Kliknij przycisk poniżej, aby **otrzymać** albo **usunąć** rangę SMP.\n\n" +
          "• Nie masz rangi → przycisk ją nada\n" +
          "• Masz rangę → przycisk ją usunie"
        )
        .setFooter({ text: "PackSMP • Zarządzanie rangą" });

      const smpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("smp_role_toggle")
          .setLabel("🎮 Otrzymaj / Usuń rangę SMP")
          .setStyle(ButtonStyle.Success),
      );

      await (message.channel as TextChannel).send({ embeds: [smpEmbed], components: [smpRow] });
      await message.reply("✅ Panel rangi SMP został wysłany.");
      break;
    }

    case "whitelist": {
      if (!isAdmin(message)) { await message.reply("❌ Brak uprawnień."); return; }
      const action = args[0]?.toLowerCase();
      const nick = args[1];
      if (!nick || !["dodaj", "usun", "add", "remove"].includes(action ?? "")) {
        await message.reply("❌ Użycie: `=whitelist dodaj <nick>` lub `=whitelist usun <nick>`");
        return;
      }
      const mcAction = ["dodaj", "add"].includes(action!) ? "add" : "remove";
      const sent = await sendChatMessage(`/whitelist ${mcAction} ${nick}`);
      const verb = mcAction === "add" ? "dodano do" : "usunięto z";
      await message.reply(sent
        ? `📋 Gracza **${nick}** ${verb} whitelisty.`
        : "❌ Bot MC offline — nie można wykonać komendy."
      );
      break;
    }
  }
}

async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === "smp_role_toggle") {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Nie można pobrać danych członka.", flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      // Acknowledge immediately — Discord invalidates button interactions
      // after roughly three seconds if no response was sent.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // These are independent API calls, so fetch them in parallel.
      const [member, role, botMember] = await Promise.all([
        guild.members.fetch(interaction.user.id),
        guild.roles.fetch(SMP_ROLE_ID),
        guild.members.me ?? guild.members.fetchMe(),
      ]);

      if (!role) {
        await interaction.editReply({ content: `❌ Nie znaleziono rangi SMP o ID \`${SMP_ROLE_ID}\`.` });
        return;
      }
      if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await interaction.editReply({ content: "❌ Bot nie ma uprawnienia **Zarządzanie rolami**." });
        return;
      }
      if (role.position >= botMember.roles.highest.position) {
        await interaction.editReply({
          content: "❌ Ranga SMP jest wyżej lub na tym samym poziomie co najwyższa rola bota. Przenieś rolę bota wyżej w ustawieniach serwera Discord.",
        });
        return;
      }

      const hasRole = member.roles.cache.has(role.id);
      if (hasRole) {
        await member.roles.remove(role);
        await interaction.editReply({ content: "✅ Usunięto Ci rangę **SMP**." });
      } else {
        await member.roles.add(role);
        await interaction.editReply({ content: "🎮 Otrzymałeś/aś rangę **SMP**!" });
      }
    } catch (err) {
      logger.warn({ err: String(err), roleId: SMP_ROLE_ID, userId: interaction.user.id }, "Failed to toggle SMP role");
      const errorMessage = "❌ Discord odrzucił zmianę rangi. Sprawdź pozycję roli SMP i uprawnienie **Zarządzanie rolami** bota.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorMessage }).catch(() => {});
      } else {
        await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.customId.startsWith("wynik_form_page:")) {
    const pageIndex = parseInt(interaction.customId.split(":")[1] ?? "0", 10);
    const page = RESULT_FORM_PAGES[pageIndex];
    if (!page) {
      await interaction.reply({ content: "❌ Ta strona formularza jest nieprawidłowa.", flags: MessageFlags.Ephemeral });
      return;
    }

    const storeKey = `wynik:${interaction.channelId}:${interaction.user.id}`;
    if (pageIndex === 0) await dbDeleteFormAnswers(storeKey);

    const modal = new ModalBuilder()
      .setCustomId(`wynik_modal:${interaction.channelId}:${interaction.user.id}:${pageIndex}`)
      .setTitle(`Wynik rekrutacji — ${pageIndex + 1}/${RESULT_FORM_PAGES.length}`);

    modal.addComponents(
      ...page.map((field) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label.slice(0, 45))
            .setPlaceholder(field.placeholder.slice(0, 100))
            .setStyle(field.style)
            .setRequired(field.required ?? true)
        )
      )
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "verify_generate") {
    const result = await generateVerificationCode(interaction.user.id);
    if ("error" in result) {
      await interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
      return;
    }
    const expiresIn = Math.floor((result.expiresAt.getTime() - Date.now()) / 60000);
    await interaction.reply({
      content: [
        "🔑 **Twój kod weryfikacyjny:**",
        `\`\`\`${result.code}\`\`\``,
        `⏰ Kod wygasa za **${expiresIn} minut**.`,
        ``,
        `**Jak zweryfikować konto:**`,
        `1. Wejdź na serwer PackSMP`,
        `2. Wyślij prywatnie do bota **${BOT_NICK}**:`,
        `\`/msg ${BOT_NICK} =verify ${result.code}\``,
        ``,
        `⚠️ Nie udostępniaj tego kodu nikomu!`,
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  } else if (interaction.customId === "verify_help") {
    await interaction.reply({
      content: [
        "❓ **Instrukcja weryfikacji konta:**",
        "",
        "**1.** Kliknij przycisk 🔐 Zweryfikuj konto",
        "**2.** Otrzymasz prywatny 32-znakowy kod (widoczny tylko dla Ciebie)",
        "**3.** Wejdź na serwer Minecraft",
        `**4.** Wyślij prywatną wiadomość do bota \`${BOT_NICK}\`:`,
        `\`/msg ${BOT_NICK} =verify <twój-kod>\``,
        "**5.** Gotowe! Otrzymasz rolę i Twój nick Discord zmieni się na nick MC",
        "",
        "❗ Kod jest jednorazowy i wygasa po **15 minutach**.",
        "❗ Jeden kod na użytkownika — stary kod wygasa po wygenerowaniu nowego.",
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  } else if (interaction.customId === "verify_status") {
    const status = await getVerificationStatusByDiscord(interaction.user.id);
    await interaction.reply({
      content: status?.isVerified
        ? `✅ **Konto zweryfikowane!**\n🎮 Nick Minecraft: \`${status.mcNick}\`\n📅 Data: ${status.verifiedAt?.toLocaleDateString("pl-PL")}`
        : "❌ **Konto nie jest jeszcze zweryfikowane.**\nKliknij 🔐 Zweryfikuj konto aby rozpocząć.",
      flags: MessageFlags.Ephemeral,
    });

  } else if (interaction.customId.startsWith("ticket_type:")) {
    const [, type, targetId] = interaction.customId.split(":");
    const ticketType = type as TicketType | undefined;
    const form = ticketType ? TICKET_FORMS[ticketType] : undefined;
    if (!form || !ticketType) {
      await interaction.reply({ content: "❌ Nie udało się wybrać formularza.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.update({
      content: `${form.intro}\n\n${form.pages.length === 1 ? "Formularz zostanie wysłany poniżej." : `Osobne formularze dla każdej z ${form.pages.length} stron zostaną wysłane poniżej:`}`,
      components: [],
    });
    for (const [pageIndex] of form.pages.entries()) {
      const pageButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`fill_form_page:${ticketType}:${targetId ?? interaction.user.id}:${pageIndex}`)
          .setLabel(`📝 Otwórz formularz — ${pageIndex + 1}. strona`)
          .setStyle(ButtonStyle.Primary)
      );
      await (interaction.channel as TextChannel | null)?.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`📋 Formularz — ${pageIndex + 1}. strona`)
            .setColor(form.color)
            .setDescription(
              `${form.title}\n\n` +
              `Kliknij przycisk poniżej, aby wypełnić **${pageIndex + 1}. stronę** formularza.`
            )
            .setFooter({ text: `${form.footer} • Strona ${pageIndex + 1}/${form.pages.length}` }),
        ],
        components: [pageButton],
      });
    }

    const reviewRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ra:${ticketType}:${targetId ?? interaction.user.id}`)
        .setLabel("✅ Akceptuj")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rr:${ticketType}:${targetId ?? interaction.user.id}`)
        .setLabel("❌ Odrzuć")
        .setStyle(ButtonStyle.Danger),
    );
    await (interaction.channel as TextChannel | null)?.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🛡️ Panel administracyjny")
          .setColor(0xFEE75C)
          .setDescription(`**Typ ticketa:** ${form.title}\n**Zgłaszający:** <@${targetId ?? interaction.user.id}>`)
          .setTimestamp(),
      ],
      components: [reviewRow],
    });

  } else if (interaction.customId.startsWith("fill_form_page:")) {
    // Multi-page form — subsequent pages triggered by ephemeral button
    // customId: fill_form_page:<type>:<userId>:<pageIndex>
    const [, type, , pageStr] = interaction.customId.split(":");
    const ticketType = type as TicketType | undefined;
    const pageIndex = parseInt(pageStr ?? "1", 10);
    const form = ticketType ? TICKET_FORMS[ticketType] : undefined;
    if (!form || !ticketType || pageIndex >= form.pages.length) {
      await interaction.reply({ content: "❌ Nie udało się otworzyć formularza.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (pageIndex === 0) {
      await dbDeleteFormAnswers(`${interaction.user.id}:${ticketType}`);
    }

    const page = form.pages[pageIndex];
    const totalPages = form.pages.length;
    const pageLabel = ` (${pageIndex + 1}/${totalPages})`;

    const modal = new ModalBuilder()
      .setCustomId(`modal_form:${ticketType}:${interaction.user.id}:${pageIndex}`)
      .setTitle((form.title + pageLabel).slice(0, 45));

    modal.addComponents(
      ...page.map((field) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label.slice(0, 45))
            .setPlaceholder(field.placeholder.slice(0, 100))
            .setStyle(field.style)
            .setRequired(field.required ?? true)
        )
      )
    );
    await interaction.showModal(modal);

  } else if (interaction.customId.startsWith("fill_form:")) {
    const [, type] = interaction.customId.split(":");
    const ticketType = type as TicketType | undefined;
    const form = ticketType ? TICKET_FORMS[ticketType] : undefined;
    if (!form || !ticketType) {
      await interaction.reply({ content: "❌ Nie udało się otworzyć formularza.", flags: MessageFlags.Ephemeral });
      return;
    }

    // Clear any stale partial answers for this user+type
    await dbDeleteFormAnswers(`${interaction.user.id}:${ticketType}`);

    const pageIndex = 0;
    const page = form.pages[pageIndex];
    const totalPages = form.pages.length;
    const pageLabel = totalPages > 1 ? ` (${pageIndex + 1}/${totalPages})` : "";

    const modal = new ModalBuilder()
      .setCustomId(`modal_form:${ticketType}:${interaction.user.id}:${pageIndex}`)
      .setTitle((form.title + pageLabel).slice(0, 45));

    modal.addComponents(
      ...page.map((field) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label.slice(0, 45))
            .setPlaceholder(field.placeholder.slice(0, 100))
            .setStyle(field.style)
            .setRequired(field.required ?? true)
        )
      )
    );
    await interaction.showModal(modal);

  // ── Ticket panel buttons ─────────────────────────────────────────────────
  } else if (interaction.customId.startsWith("ra:") || interaction.customId.startsWith("rr:")) {
    // Skip if already resolved (disabled buttons reuse "ra:done")
    if (interaction.customId.endsWith(":done")) return;

    const member = interaction.member as any;
    const hasPermission =
      member?.permissions?.has?.(PermissionsBitField.Flags.Administrator) ||
      member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild) ||
      member?.roles?.cache?.has?.(RECRUIT_ROLE_ID) ||
      (Array.isArray(member?.roles) && member.roles.includes(RECRUIT_ROLE_ID));

    if (!hasPermission) {
      await interaction.reply({ content: "❌ Nie masz uprawnień do rozpatrywania zgłoszeń.", flags: MessageFlags.Ephemeral });
      return;
    }

    const isAccept = interaction.customId.startsWith("ra:");
    // Format: ra:<type>:<userId>  or  rr:<type>:<userId>
    const parts = interaction.customId.slice(3).split(":");  // strip "ra:" or "rr:"
    const ticketType = parts[0] as "rekrutacja" | "sojusz" | "konkurs" | "walka" | undefined;
    const targetId = parts[1] ?? "unknown";
    const reviewer = (interaction.member as any)?.displayName ?? interaction.user.username;

    await interaction.deferUpdate();

    // Disable buttons and show result
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ra:done").setLabel(isAccept ? "✅ Zaakceptowano" : "✅ Akceptuj").setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId("rr:done").setLabel(isAccept ? "❌ Odrzuć" : "❌ Odrzucono").setStyle(ButtonStyle.Danger).setDisabled(true),
    );

    const resultEmbed = new EmbedBuilder()
      .setColor(isAccept ? 0x57F287 : 0xED4245)
      .setDescription(isAccept ? `✅ **Zaakceptowano** przez **${reviewer}**` : `❌ **Odrzucono** przez **${reviewer}**`)
      .setTimestamp();

    await interaction.editReply({ components: [disabledRow], embeds: [resultEmbed] });

    const ch = interaction.channel as TextChannel | null;
    const mention = targetId !== "unknown" ? `<@${targetId}>` : null;

    // ── Accept messages by type ────────────────────────────────────
    if (isAccept) {
      const acceptMessages: Record<string, string> = {
        rekrutacja:
          `✅ ${mention ?? "Kandydacie"} — Twoja aplikacja rekrutacyjna została **zaakceptowana**! 🎉\n` +
          `Zapraszamy do poczekalni — oczekuj tam na **Etap 2** (rozmowa głosowa).`,
        sojusz:
          `✅ ${mention ?? "Witajcie"} — Wasz wniosek o sojusz został **zaakceptowany**! 🤝\n` +
          `Administracja PackOfDeath skontaktuje się z Wami wkrótce w sprawie szczegółów.`,
        konkurs:
          `✅ ${mention ?? "Gratulacje"} — Twoja wygrana została **potwierdzona**! 🏆\n` +
          `Administracja przekaże Ci nagrodę — cierpliwie oczekuj.`,
        walka:
          `✅ ${mention ?? "Zapraszamy"} — Propozycja walki klatki została **zatwierdzona**! ⚔️\n` +
          `Administracja potwierdzi termin i szczegóły organizacji.`,
      };

      await ch?.send({ content: acceptMessages[ticketType ?? "rekrutacja"] ?? acceptMessages.rekrutacja });

      // Ping in waiting channel only for recruitment
      if (ticketType === "rekrutacja") {
        try {
          const waitCh = await client!.channels.fetch(RECRUIT_WAITING_CHANNEL_ID);
          if (waitCh?.isTextBased()) {
            const waitEmbed = new EmbedBuilder()
              .setTitle("🎙️ Nowy kandydat w poczekalni!")
              .setColor(0x57F287)
              .setDescription(
                mention
                  ? `${mention} przeszedł Etap 1 i oczekuje na **Etap 2** — rozmowę głosową.\n\nTicket: ${ch?.toString() ?? "—"}`
                  : `Nowy kandydat oczekuje na **Etap 2**.\n\nTicket: ${ch?.toString() ?? "—"}`
              )
              .setFooter({ text: `Zaakceptował: ${reviewer}` })
              .setTimestamp();
            await (waitCh as TextChannel).send({ content: mention ?? undefined, embeds: [waitEmbed] });
          }
        } catch { /* ignore */ }
      }

    // ── Reject messages by type ────────────────────────────────────
    } else {
      const rejectMessages: Record<string, string> = {
        rekrutacja:
          `❌ ${mention ?? "Kandydacie"} — Niestety Twoja aplikacja rekrutacyjna została **odrzucona**.\n` +
          `Dziękujemy za zainteresowanie ekipą PackOfDeath! Ticket zostanie wkrótce zamknięty.`,
        sojusz:
          `❌ ${mention ?? "Witajcie"} — Wasz wniosek o sojusz został **odrzucony**.\n` +
          `Dziękujemy za zainteresowanie PackOfDeath. Ticket zostanie wkrótce zamknięty.`,
        konkurs:
          `❌ ${mention ?? "Hej"} — Twoje zgłoszenie wygranej zostało **odrzucone**.\n` +
          `Jeśli uważasz to za błąd, skontaktuj się z administracją. Ticket zostanie wkrótce zamknięty.`,
        walka:
          `❌ ${mention ?? "Hej"} — Propozycja walki klatki została **odrzucona**.\n` +
          `Dziękujemy za kontakt. Ticket zostanie wkrótce zamknięty.`,
      };

      await ch?.send({ content: rejectMessages[ticketType ?? "rekrutacja"] ?? rejectMessages.rekrutacja });
    }
  }
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId.startsWith("wynik_modal:")) {
    await handleResultFormModalSubmit(interaction);
    return;
  }

  if (!interaction.customId.startsWith("modal_form:")) return;

  // Acknowledge immediately — DB calls below can take >3s and Discord would
  // reject the interaction with "Unknown interaction" without this.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // customId format: modal_form:<type>:<userId>:<pageIndex>
  const parts = interaction.customId.split(":");
  const ticketType = parts[1] as TicketType | undefined;
  const pageIndex = parseInt(parts[3] ?? "0", 10);

  if (!ticketType || !TICKET_FORMS[ticketType]) {
    await interaction.editReply({ content: "❌ Nieznany typ formularza." });
    return;
  }

  const form = TICKET_FORMS[ticketType];
  const storeKey = `${interaction.user.id}:${ticketType}`;

  // Collect answers from this page
  const currentPage = form.pages[pageIndex];
  if (!currentPage) {
    await interaction.editReply({
      content: "❌ Ta strona formularza jest nieprawidłowa. Otwórz formularz ponownie z aktualnej wiadomości.",
    });
    return;
  }

  const stored = await dbGetFormAnswers(storeKey);
  for (const field of currentPage) {
    try {
      stored[field.id] = interaction.fields.getTextInputValue(field.id).trim() || "*(brak odpowiedzi)*";
    } catch { stored[field.id] = "*(brak odpowiedzi)*"; }
  }
  await dbSetFormAnswers(storeKey, interaction.user.id, ticketType, stored);

  const allPagesDone = form.pages
    .flat()
    .every(field => stored[field.id] !== undefined);

  if (!allPagesDone) {
    await interaction.editReply({
      content: `✅ **Strona ${pageIndex + 1}/${form.pages.length} zapisana.** Wypełnij pozostałe strony z wiadomości w ticketcie.`,
    });
    return;
  }

  // All pages done — build final embed with all answers
  await dbDeleteFormAnswers(storeKey);

  // Discord limits one embed to 25 fields and 6000 total characters.
  // Split long submissions into multiple embeds so the final answer is
  // delivered even when paragraph fields contain a lot of text.
  const allFields = form.pages.flat();
  const resultEmbeds: EmbedBuilder[] = [];
  let currentEmbed = new EmbedBuilder()
    .setTitle(form.title)
    .setColor(form.color)
    .setDescription(`📋 **Formularz wypełniony przez** <@${interaction.user.id}>`);
  let currentFieldCount = 0;
  let currentCharacterCount = form.title.length + 80;

  for (const field of allFields) {
    const answer = (stored[field.id] ?? "*(brak odpowiedzi)*").trim();
    const value = answer.length > 1000 ? `${answer.slice(0, 997)}...` : answer;
    // Prefix the field name so questions stand out from answers
    const questionLabel = `❓ ${field.label}`.slice(0, 256);
    const fieldCost = questionLabel.length + value.length;

    if (
      currentFieldCount >= 25 ||
      (currentFieldCount > 0 && currentCharacterCount + fieldCost > 5500)
    ) {
      currentEmbed.setFooter({ text: form.footer }).setTimestamp();
      resultEmbeds.push(currentEmbed);
      currentEmbed = new EmbedBuilder()
        .setTitle(`${form.title} — ciąg dalszy`)
        .setColor(form.color);
      currentFieldCount = 0;
      currentCharacterCount = form.title.length + 20;
    }

    currentEmbed.addFields({
      name: questionLabel,
      value: `> ${value.replace(/\n/g, "\n> ")}`,
      inline: false,
    });
    currentFieldCount++;
    currentCharacterCount += fieldCost;
  }

  currentEmbed.setFooter({ text: form.footer }).setTimestamp();
  resultEmbeds.push(currentEmbed);

  // Fetch channel robustly — interaction.channel can be null for uncached/partial channels
  let ch = interaction.channel as TextChannel | null;
  if (!ch && interaction.channelId) {
    try {
      ch = (await interaction.client.channels.fetch(interaction.channelId)) as TextChannel;
    } catch (err) {
      logger.warn({ err: String(err) }, "handleModalSubmit: could not fetch channel to send form result");
    }
  }

  if (ch?.isTextBased()) {
    await (ch as TextChannel).send({
      content: `📋 **Wypełniony formularz od** <@${interaction.user.id}>`,
      embeds: resultEmbeds,
    });
  } else {
    logger.error({ channelId: interaction.channelId, ticketType }, "handleModalSubmit: channel unavailable, form result not sent");
  }

  await interaction.editReply({
    content: "✅ Formularz wysłany! Administracja zapozna się z Twoimi odpowiedziami wkrótce.",
  });

  await logEvent("info", "ticket", `Formularz ${ticketType} wypełniony przez ${interaction.user.tag} (${interaction.user.id})`);
}

function buildRecruitmentResultEmbed(
  answers: Record<string, string>,
  isTest: boolean,
  guildIcon?: string | null,
): EmbedBuilder {
  const status = (answers.status ?? "").toLowerCase();
  const isRejected = status.includes("nie") || status.includes("odrzu") || status.includes("fail");
  const resultTitle = `${isTest ? "🧪 TEST • " : ""}${isRejected ? "🚩 Rekrutacja niezdana" : "✅ Rekrutacja zdana"}`;
  const resultColor = isRejected ? 0xED4245 : 0x57F287;
  const participant = answers.participant ?? "*(brak odpowiedzi)*";
  const examiner = answers.examiner ?? "*(brak odpowiedzi)*";
  const pvpLevel = answers.pvp_level ?? "*(brak odpowiedzi)*";
  const totalResult = answers.total_result ?? "*(brak odpowiedzi)*";
  const rounds = (answers.rounds ?? "*(brak odpowiedzi)*")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `🔵 ${line}`)
    .join("\n") || "*(brak odpowiedzi)*";
  const notes = answers.notes ?? "*(brak odpowiedzi)*";

  const embed = new EmbedBuilder()
    .setAuthor({ name: isTest ? "PackSMP • Podgląd testowy" : "PackSMP • Wynik rekrutacji" })
    .setTitle(resultTitle)
    .setColor(resultColor)
    .setDescription(
      `${participant} ${isRejected ? "🚩 nie zdał(a) rekrutacji." : "✅ zdał(a) rekrutację."}`
    )
    .addFields(
      { name: "👥 Uczestnik:", value: participant.slice(0, 1024), inline: false },
      { name: "⚙️ Egzaminator:", value: examiner.slice(0, 1024), inline: false },
      { name: "🏅 Poziom PvP:", value: pvpLevel.slice(0, 1024), inline: false },
      { name: "📊 Wyniki walk:", value: rounds.slice(0, 1024), inline: false },
      { name: "🏅 Łączny wynik:", value: totalResult.slice(0, 1024), inline: false },
      { name: "Uwagi:", value: notes.slice(0, 1024), inline: false },
    )
    .setFooter({
      text: isTest
        ? "PackSMP • TEST — przykładowy wynik, nie jest prawdziwym podaniem"
        : "PackSMP • Wynik rekrutacji",
    })
    .setTimestamp();

  if (guildIcon) embed.setThumbnail(guildIcon);
  return embed;
}

async function handleResultFormModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parts = interaction.customId.split(":");
  const channelId = parts[1] ?? interaction.channelId;
  const pageIndex = parseInt(parts[3] ?? "0", 10);
  const page = RESULT_FORM_PAGES[pageIndex];

  if (!page) {
    await interaction.editReply({ content: "❌ Ta strona formularza jest nieprawidłowa." });
    return;
  }

  const storeKey = `wynik:${channelId}:${interaction.user.id}`;
  const stored = await dbGetFormAnswers(storeKey);
  for (const field of page) {
    try {
      stored[field.id] = interaction.fields.getTextInputValue(field.id).trim() || "*(brak odpowiedzi)*";
    } catch {
      stored[field.id] = "*(brak odpowiedzi)*";
    }
  }
  await dbSetFormAnswers(storeKey, interaction.user.id, "wynik", stored);

  const allPagesDone = RESULT_FORM_PAGES
    .flat()
    .every((field) => stored[field.id] !== undefined);

  if (!allPagesDone) {
    await interaction.editReply({
      content: `✅ Strona ${pageIndex + 1}/${RESULT_FORM_PAGES.length} zapisana. Uzupełnij drugą stronę formularza.`,
    });
    return;
  }

  await dbDeleteFormAnswers(storeKey);

  const guildIcon = interaction.guild?.iconURL({ extension: "png", size: 256 });
  const resultEmbed = buildRecruitmentResultEmbed(stored, false, guildIcon);
  const participant = stored.participant ?? "*(brak odpowiedzi)*";

  let channel = interaction.channel as TextChannel | null;
  if (!channel && interaction.channelId) {
    try {
      channel = (await interaction.client.channels.fetch(interaction.channelId)) as TextChannel;
    } catch (err) {
      logger.warn({ err: String(err), channelId: interaction.channelId }, "Could not fetch result form channel");
    }
  }

  if (channel?.isTextBased()) {
    const participantMentionIds = [...participant.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]!);
    await channel.send({
      content: participantMentionIds.length > 0 ? participant : "📋 **Nowy wynik rekrutacji**",
      embeds: [resultEmbed],
      allowedMentions: participantMentionIds.length > 0 ? { users: participantMentionIds } : { parse: [] },
    });
  } else {
    logger.error({ channelId: interaction.channelId }, "Result form channel unavailable");
  }

  await interaction.editReply({
    content: "✅ Wynik rekrutacji został opublikowany na tym kanale.",
  });
  await logEvent("info", "ticket", `Wynik rekrutacji opublikowany przez ${interaction.user.tag} (${interaction.user.id})`);
}

export async function createVerificationPanel(channel: TextChannel): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("🔐 Weryfikacja konta PackSMP")
    .setDescription(
      "Połącz swoje konto Discord z kontem Minecraft, aby uzyskać dostęp do serwera.\n\n" +
      "**Jak to działa?**\n" +
      "1. Kliknij **🔐 Zweryfikuj konto** — otrzymasz jednorazowy kod\n" +
      "2. Wejdź na serwer Minecraft i wpisz kod\n" +
      "3. Gotowe — otrzymasz rolę i nick MC\n\n" +
      "Kliknij ❓ **Instrukcja** jeśli potrzebujesz pomocy."
    )
    .setColor(0x5865F2)
    .setFooter({ text: "PackSMP • Panel weryfikacji • Kod ważny 15 minut" })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("verify_generate").setLabel("🔐 Zweryfikuj konto").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("verify_help").setLabel("❓ Instrukcja").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("verify_status").setLabel("📊 Status").setStyle(ButtonStyle.Secondary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function onMcVerificationSuccess(discordId: string, mcNick: string): Promise<void> {
  try {
    const guild = client?.guilds.cache.get(GUILD_ID) ?? await client?.guilds.fetch(GUILD_ID);
    if (!guild) return;

    const member = guild.members.cache.get(discordId) ?? await guild.members.fetch(discordId).catch(() => null);
    if (!member) return;

    // Grant verified role
    if (VERIFY_ROLE_ID) {
      await member.roles.add(VERIFY_ROLE_ID);
    }

    // Save old nick and set new nick to MC nick
    const oldNick = member.displayName;
    await db.update(verifiedUsersTable)
      .set({ discordNickBefore: oldNick, updatedAt: new Date() })
      .where(eq(verifiedUsersTable.discordId, discordId));

    try {
      await member.setNickname(mcNick, "Weryfikacja MC ↔ DC");
    } catch {
      // Bot might not have permission to change nick of admins/owner
    }

    // DM the user
    try {
      const dm = await member.createDM();
      await dm.send(
        `✅ **Weryfikacja zakończona sukcesem!**\n\n` +
        `🎮 Nick Minecraft: \`${mcNick}\`\n` +
        `🏷️ Rola nadana: <@&${VERIFY_ROLE_ID}>\n\n` +
        `Możesz teraz korzystać z pełnych funkcji serwera PackSMP!`
      );
    } catch { /* DMs might be closed */ }

    // Announce in chat channel
    const channel = client?.channels.cache.get(CHAT_CHANNEL_ID);
    if (channel?.isTextBased()) {
      await (channel as TextChannel).send(`🎉 **${mcNick}** zweryfikował swoje konto Discord! Witaj na PackSMP!`);
    }

    await logEvent("info", "verification", `Nadano rolę i zmieniono nick: ${discordId} → ${mcNick}`);
  } catch (err) {
    logger.error({ err: String(err) }, "Error granting verification role");
    await logEvent("error", "verification", `Błąd nadawania roli: ${String(err)}`);
  }
}

export async function relayDiscordToMc(content: string): Promise<void> {
  await sendChatMessage(content);
}

export async function restartDiscordBot(): Promise<void> {
  if (client) {
    try { client.destroy(); } catch { /* ignore */ }
    client = null;
    isReady = false;
  }
  await startDiscordBot();
}
