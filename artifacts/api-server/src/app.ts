import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { existsSync } from "node:fs";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { apiRateLimiter } from "./middlewares/rate-limiter.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(apiRateLimiter);

app.use("/api", router);

// Serve the admin panel from the same Render service in production.
// The API remains available under /api and Vite's SPA routes fall back to index.html.
const adminPanelDir = path.resolve(
  process.cwd(),
  "artifacts/admin-panel/dist/public",
);
const adminPanelIndex = path.join(adminPanelDir, "index.html");

if (existsSync(adminPanelIndex)) {
  app.use(express.static(adminPanelDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(adminPanelIndex);
  });
}

export default app;
