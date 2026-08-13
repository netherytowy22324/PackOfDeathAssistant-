import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import dashboardRouter from "./dashboard.js";
import verificationsRouter from "./verifications.js";
import messagesRouter from "./messages.js";
import configRouter from "./config-route.js";
import logsRouter from "./logs.js";
import statusRouter from "./status.js";
import adminCommandsRouter from "./admin-commands.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/dashboard", dashboardRouter);
router.use("/verifications", verificationsRouter);
router.use("/messages", messagesRouter);
router.use("/config", configRouter);
router.use("/logs", logsRouter);
router.use("/status", statusRouter);
router.use("/commands", adminCommandsRouter);

export default router;
