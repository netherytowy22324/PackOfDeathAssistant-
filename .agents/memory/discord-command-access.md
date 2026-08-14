---
name: Discord command access
description: The durable access policy for Discord bot commands
---

All Discord bot commands except basic information, help, and a user's own verification commands require the member's effective Administrator permission.

**Why:** The owner requested that only roles carrying the Discord Administrator permission can use administrative bot commands; role names and Manage Server are not sufficient.

**How to apply:** Keep new Discord commands behind the same central Administrator gate unless they are clearly public information, help, or self-service verification.