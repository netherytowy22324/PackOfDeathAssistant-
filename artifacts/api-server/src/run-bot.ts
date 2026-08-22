// Wymuszenie IPv4 dla bezpiecznego połączenia z bazą danych
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { startDiscordBot } from "./services/discord-bot.js";

async function bootstrap() {
  console.log("=== STARTOWANIE SAMODZIELNEGO PROCESU BOTA DISCORD ===");
  await startDiscordBot();
}

bootstrap().catch((err) => {
  console.error("Krytyczny błąd podczas samodzielnego startu bota:", err);
});
