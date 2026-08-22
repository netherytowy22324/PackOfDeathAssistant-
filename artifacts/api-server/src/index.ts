import { Client, GatewayIntentBits, MessageFlags, TextChannel } from "discord.js";
import { db, pendingFormAnswersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger.js";

// Konfiguracja ID kanału rekrutacji i typów formularzy
const RECRUIT_WAITING_CHANNEL_ID = process.env["DISCORD_RECRUIT_CHANNEL_ID"] ?? "";

export type TicketType = "sojusz" | "konkurs" | "walka" | "rekrutacja";

export interface TicketField {
  id: string;
  label: string;
}

export interface TicketForm {
  title: string;
  intro: string;
  color: number;
  footer: string;
  pages: TicketField[][];
}

// Inicjalizacja klienta bota Discord
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Rejestracja bota w obiekcie globalnym (Naprawa błędu Patchera)
(global as any).client = client;

// Funkcja eksportująca klienta
export function getDiscordClient() {
  return client;
}

// Główna funkcja startowa wywoływana w src/index.ts
export async function startDiscordBot(): Promise<void> {
  const token = process.env["DISCORD_TOKEN"];
  if (!token) {
    logger.error("Brak zmiennej DISCORD_TOKEN w środowisku! Nie można uruchomić bota.");
    return;
  }

  client.once("ready", () => {
    logger.info(`Discord bot zalogowany pomyślnie jako: ${client.user?.tag}`);
  });

  try {
    await client.login(token);
  } catch (err) {
    logger.error({ err }, "Błąd podczas logowania bota do Discorda");
  }
}

// Interceptor obsługujący nadsyłanie formularzy rekrutacyjnych z Modali
if (typeof client !== "undefined" && client) {
  client.on("interactionCreate", async (interaction: any) => {
    if (!interaction.isModalSubmit()) return;
    const [prefix, ticketType, pageStr] = interaction.customId.split(":");
    if (prefix !== "ticket_modal" || ticketType !== "rekrutacja") return;

    const currentPage = parseInt(pageStr ?? "0", 10);
    const form = (typeof DODATKOWE_FORMULARZE !== "undefined" ? DODATKOWE_FORMULARZE["rekrutacja"] : null) || (typeof TICKET_FORMS !== "undefined" ? TICKET_FORMS["rekrutacja"] : null);
    
    if (form && currentPage === form.pages.length - 1) {
      const cacheKey = `form:${interaction.user.id}:rekrutacja`;
      try {
        const rows = await db.select().from(pendingFormAnswersTable).where(eq(pendingFormAnswersTable.key, cacheKey));
        if (rows.length > 0) {
          const currentAnswers = JSON.parse(rows[0].answers);
          await sendFormattedRecruitment(interaction, currentAnswers, RECRUIT_WAITING_CHANNEL_ID);
        }
      } catch (e) {
        logger.error(e, "Błąd w przechwytywaniu wysyłki formularza");
      }
    }
  });
}

// Funkcja budująca i wysyłająca sformatowaną aplikację na kanał tekstowy
async function sendFormattedRecruitment(interaction: any, answers: Record<string, string>, channelId: string) {
  const guild = interaction.guild;
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId) as TextChannel;
  if (!channel) {
    logger.error(`Nie znaleziono kanału rekrutacji o ID: ${channelId}`);
    return;
  }

  const formattedMessage = `======================================
         PODANIE REKRUTACYJNE
======================================

📥  **INFORMACJE O GRACZU**
> 🔹 **1. Nick w grze:** \`${answers['nick'] ?? 'Brak danych'}\`
> 🔹 **2. Wiek:** \`${answers['wiek'] ?? 'Brak'}\` lat
> 🔹 **3. Jak się zwracać:** \`${answers['zwracanie'] ?? 'Brak danych'}\`

⚔️  **STATYSTYKI I AKTYWNOŚĆ**
> ⚔️ **4. PvP:** 📊 \`${answers['pvp'] ?? '0'}/10\`
> 🏗️ **5. Budowanie:** 📊 \`${answers['budowanie'] ?? '0'}/10\`
> 🔥 **6. Aktywność:** 📊 \`${answers['aktywnosc'] ?? '0'}/10\`
> ⏳ **7. Czas dzienny na grę:** 🕒 \`${answers['czas'] ?? 'Brak danych'}\`

🌍  **HISTORIA I OSIĄGNIĘCIA**
💬 *8. Poprzednie państwa, w których grałeś:*
\`\`\`text
${answers['panstwa'] ?? 'Brak danych'}
\`\`\`
🏅 *9. Posiadane tam rangi / funkcje:*
\`\`\`text
${answers['rangi'] ?? 'Brak danych'}
\`\`\`
🏆 *10. Największe osiągnięcia:*
\`\`\`text
${answers['osiagniecia'] ?? 'Brak danych'}
\`\`\`

🧪  **PROFIL GRACZA I PYTANIA KOŃCOWE**
> 💡 **11. W czym najlepszy (PvP/Build/Eko...):** ⭐ \`${answers['w_czym'] ?? 'Brak danych'}\`
> 🎙️ **12. Sprawny mikrofon:** \`${answers['mikrofon'] ?? 'NIE'}\`
> 📱 **13. Aktywność na Discordzie:** 💬 \`${answers['aktywnosc_dc'] ?? 'Brak danych'}\`

👑 *14. Dlaczego chcesz dołączyć właśnie do naszego państwa?*
\`\`\`text
${answers['powod'] ?? 'Brak danych'}
\`\`\`
🎯 *15. Dlaczego powinniśmy wybrać właśnie Ciebie?*
\`\`\`text
${answers['uzasadnienie'] ?? 'Brak danych'}
\`\`\`

======================================
Jeżeli podanie zostanie zaakceptowane, ticket zostanie przejęty przez rekrutera. W przypadku odrzucenia – ticket zostanie zamknięty.
======================================`;

  await channel.send({ content: formattedMessage });

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({
      content: "Twoje podanie zostało pomyślnie wysłane!",
      flags: MessageFlags.Ephemeral
    });
  }
}

// Definicja obiektu z dodatkowymi konfiguracjami formularzy (zostawia Twoje komendy pod spodem nienaruszone)
export const DODATKOWE_FORMULARZE: any = {
  sojusz: {
    title: "🤝 Formularz sojuszu",
    intro: "Przedstaw propozycję sojuszu.",
    color: 0x57F287,
    footer: "PackSMP • Sojusze",
    pages: [[
      { id: "group_name", label: "Nazwa grupy/serwera" },
      { id: "members", label: "Liczba członków" },
      { id: "offer", label: "Co oferujecie?" },
      { id: "expectations", label: "Czego oczekujecie?" }
    ]]
  },
  konkurs: {
    title: "🏆 Formularz zgłoszenia wygranej",
    intro: "Podaj informacje potrzebne do odebrania nagrody.",
    color: 0xFEE75C,
    footer: "PackSMP • Konkursy",
    pages: [[
      { id: "mc_nick", label: "Nick Minecraft" },
      { id: "contest", label: "Nazwa konkursu" },
      { id: "proof", label: "Dowód wygranej" },
      { id: "prize", label: "Wygrana nagroda" }
    ]]
  },
  walka: {
    title: "⚔️ Zgłoszenie walki / turnieju",
    intro: "Wypełnij dane dotyczące wyzwania.",
    color: 0xE74C3C,
    footer: "PackSMP • Walki",
    pages: [[
      { id: "opponent", label: "Przeciwnik" },
      { id: "date", label: "Proponowana data" }
    ]]
  }
};

// Domyślna konfiguracja formularzy rekrutacyjnych
export const TICKET_FORMS: Record<string, any> = {
  rekrutacja: {
    title: "📝 Formularz rekrutacji",
    intro: "Wypełnij formularz rekrutacyjny na kandydata.",
    color: 0x3498DB,
    footer: "PackSMP • Rekrutacja",
    pages: [
      [
        { id: "nick", label: "Nick w grze" },
        { id: "wiek", label: "Wiek" },
        { id: "zwracanie", label: "Jak się zwracać" }
      ]
    ]
  }
};
