---
name: PackSMP MC server hostname
description: Why MC_HOST is pl14.icehost.pl, not packsmp.icsv.pl
---

`packsmp.icsv.pl` has NO A record — only a Minecraft SRV record
(`_minecraft._tcp.packsmp.icsv.pl` → `pl14.icehost.pl:50062`, IP 83.168.94.254).
Node's getaddrinfo therefore fails with ENOTFOUND for the vanity hostname.

**Why:** Minecraft clients resolve SRV automatically; mineflayer/RCON via plain
DNS lookup do not (in this env). Use the SRV target directly.

**How to apply:** MC_HOST and RCON_HOST env vars must stay `pl14.icehost.pl`.
If the server host migrates, re-check the SRV record via
`https://dns.google/resolve?name=_minecraft._tcp.packsmp.icsv.pl&type=SRV`.
RCON port 25575 was refused as of Aug 2026 — likely disabled or different port on icehost.
