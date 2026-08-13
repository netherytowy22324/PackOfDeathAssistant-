---
name: PackSMP Bridge architecture
description: Key architectural decisions for the PackSMP Minecraft↔Discord bridge system
---

## Architecture decisions

- **Mineflayer** (Node.js) used as MC client — no Java plugin needed. Public commands use `=` prefix in Discord chat; private MC commands via whisper `/msg PackSmpSyncBot =command`.
- **discord.js v14** for Discord bot. All `=` commands in one message handler with a switch.
- **RCON** only for admin server-side commands, not for chat relay.
- **JWT** (8h) for admin panel auth; stored in localStorage.
- **Anti-loop**: `bridgeService` keeps a 5-second TTL set of recently-sent messages to prevent echo.

## OpenAPI / codegen rule (CRITICAL)

Request body schemas in `lib/api-spec/openapi.yaml` **must** use entity-shaped names (e.g. `AdminCredentials`, `PasswordChange`, `ConfigEntry`) — never `<OperationIdPascal>Body` (e.g. `LoginBody`, `ChangePasswordBody`). Orval auto-generates a `<OperationIdPascal>Body` Zod schema for every operation with a body; if the component schema has the same name, `lib/api-zod/src/index.ts` gets a TS2308 collision and typecheck:libs fails.

**Why:** Orval emits to both `generated/api.ts` (Zod) and `generated/types/` (TS interfaces); barrel re-exports both with `export *`; duplicate names cause TS2308.

**How to apply:** Every time you add a new endpoint with a request body, name the component schema after the entity/action noun, never after the operation.

## Discord command duplicate case bug

The `discord-bot.ts` switch had two `case "weryfikacja-usun"` blocks — one for self-unlink (user), one for admin-unlink-other. The admin one was renamed to `"admin-usun-weryfikacje"` to fix the esbuild duplicate-case warning that caused build failure.

**Why:** Duplicate switch cases are a silent no-op in JS but esbuild treats them as a build error.
