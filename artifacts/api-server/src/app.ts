import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
const adminPanelCandidates = [
  path.resolve(process.cwd(), "artifacts/admin-panel/dist/public"),
  path.resolve(process.cwd(), "../admin-panel/dist/public"),
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../admin-panel/dist/public",
  ),
];
const adminPanelDir =
  adminPanelCandidates.find((candidate) => existsSync(candidate)) ??
  adminPanelCandidates[0];
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
