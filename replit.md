# PackSMP Bridge — Project Overview

A 24/7 Minecraft↔Discord bridge system for the PackSMP server.

## Architecture

- **`artifacts/api-server`** — Node.js API server (Express + tsx in dev). Runs:
  - **Mineflayer** Minecraft bot — connects as player `PackSmpSyncBot`, relays public chat, handles `=command` whispers
  - **discord.js v14** Discord bot — `=` prefix commands, button interactions, verification panel
  - **RCON client** — admin server-side commands
  - **REST API** at `/api/*` — used by the admin panel
  - **Watchdog** — 30s health loop, auto-reconnect

- **`artifacts/admin-panel`** — React + Vite admin panel. Dark cockpit-style dashboard:
  - Login (JWT, stored in localStorage)
  - Dashboard (bot status, stats, recent errors)
  - Verifications (Discord↔MC account links)
  - Messages (private message log)
  - Logs (system + chat)
  - Config (DB key-value + runtime toggles)
  - RCON console (terminal-style command execution)

- **`lib/db`** — Drizzle ORM + PostgreSQL. Tables: `verified_users`, `verification_codes`, `private_messages`, `system_config`, `chat_logs`, `error_logs`
- **`lib/api-spec`** — OpenAPI 3.1 spec. Run `pnpm --filter @workspace/api-spec run codegen` after changes.
- **`lib/api-client-react`** — Generated React Query hooks (from codegen)
- **`lib/api-zod`** — Generated Zod schemas (from codegen)

## Environment Variables (shared)

| Key | Value |
|-----|-------|
| `MC_HOST` | `packsmp.icsv.pl` |
| `MC_PORT` | `50062` |
| `RCON_HOST` | `packsmp.icsv.pl` |
| `RCON_PORT` | `25575` |
| `DISCORD_GUILD_ID` | `1532081537607143664` |
| `DISCORD_CHAT_CHANNEL_ID` | `1537148128208359464` |
| `DISCORD_VERIFY_ROLE_ID` | `1537158517176148119` |
| `MC_BOT_NICK` | `PackSmpSyncBot` |
| `MC_MODE` | `offline` |
| `JWT_SECRET` | *(generated, stored as shared env var)* |

## Secrets

- `DISCORD_TOKEN` — Discord bot token (must be valid; if "TokenInvalid" error appears, regenerate in Discord Developer Portal)
- `MC_BOT_PASSWORD` — AuthMe login password for the MC bot
- `RCON_PASSWORD` — RCON connection password
- `SESSION_SECRET` — Session secret

## Known Dev Limitations

- `ENOTFOUND packsmp.icsv.pl` — Replit dev environment cannot reach external game servers. The bot connects only after deployment.
- Admin panel login needs the password hash seeded in the DB. Set a strong production password before deployment.

## Discord Commands (`=` prefix)

**Player commands (in chat channel):**
- `=weryfikacja` — show verification status
- `=weryfikacja-usun` — unlink own account
- `=msg <nick> <message>` — send private message to MC player

**Admin commands:**
- `=admin-usun-weryfikacje @user` — unlink another user's account
- `=sync-status` — show bot status embed
- `=sync-restart` / `=sync-stop` — start/stop chat sync
- `=mc-restart` / `=dc-reconnect` — restart bots
- `=maintenance [on|off]` — toggle maintenance mode
- `=rcon <command>` — execute RCON command

**Button panel:** Created with `=panel` command in target channel.

## MC Whisper Commands (to bot)

- `/msg PackSmpSyncBot =verify <code>` — verify account with code from Discord
- `/msg PackSmpSyncBot =weryfikacja` — check verification status

## User Preferences

- Polish language for Discord/MC messages and bot responses
- No Java plugin required — Mineflayer handles everything
