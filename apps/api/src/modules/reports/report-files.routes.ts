import { Router } from "express";
import { AppError } from "../../lib/errors";
import type { LocalReportStorage } from "../../lib/report-storage";
import { CONTENT_TYPES } from "./report-runner";

const INVALID_LINK = "This download link is invalid or has expired.";

/**
 * GET /report-files/:file — downloads for local (fake) report storage only. No session:
 * the HMAC signature over file, download name and expiry is the authorization, and it is
 * only issued to the report's requester (or a SUPER_ADMIN) by GET /admin/reports/:jobId.
 */
export function reportFilesRouter(storage: LocalReportStorage): Router {
  const router = Router();
  router.get("/:file", async (req, res) => {
    const opened = await storage.open(req.params.file, req.query);
    if (!opened) throw new AppError("FORBIDDEN", INVALID_LINK);
    const format = opened.filename.endsWith(".xlsx") ? "xlsx" : "csv";
    res.setHeader("Content-Type", CONTENT_TYPES[format]);
    res.setHeader("Content-Disposition", `attachment; filename="${opened.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(opened.body);
  });
  return router;
}
