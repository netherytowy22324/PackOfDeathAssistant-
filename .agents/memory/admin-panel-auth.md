---
name: Admin panel auth seeding
description: The admin password hash must be seeded in the DB on first startup; it is never auto-created
---

## Problem

The admin panel login (POST /api/auth/login) reads the bcrypt hash from `system_config` where `key = 'admin_password_hash'`. That row is never inserted automatically, so login always returns 401 until it is seeded.

## Fix (Task #2)

Add a startup seed block in `artifacts/api-server/src/index.ts` (after DB is available, before starting bots):

```ts
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { systemConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const existing = await db.select().from(systemConfigTable)
  .where(eq(systemConfigTable.key, "admin_password_hash")).limit(1);
if (!existing[0]) {
  const hash = await bcrypt.hash("12122012", 12);
  await db.insert(systemConfigTable).values({ key: "admin_password_hash", value: hash });
}
```

**Default password:** `12122012`

**Why:** The schema and route exist and are correct; the missing piece is just the initial DB row.

## JWT

JWT secret is stored as shared env var `JWT_SECRET` (generated with `crypto.randomBytes(48).toString("hex")`). Token lifetime: 8 hours. Stored in localStorage as `admin_token`.
