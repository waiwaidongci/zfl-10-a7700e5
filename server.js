import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { loadDb, sendJson, DataVersionConflictError } from "./src/db.js";
import { handleUsers } from "./src/routes/users.js";
import { handleProjects } from "./src/routes/projects.js";
import { handleIntakes } from "./src/routes/intakes.js";
import { handleMaterials } from "./src/routes/materials.js";
import { handleReviews } from "./src/routes/reviews.js";
import { handleTimeline } from "./src/routes/timeline.js";
import { handlePhotos } from "./src/routes/photos.js";
import { handleCalendar } from "./src/routes/calendar.js";
import { handleReports } from "./src/routes/reports.js";
import { handleTemplates } from "./src/routes/templates.js";
import { handleAudit } from "./src/routes/audit.js";
import { handleSync } from "./src/routes/sync.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3010);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

async function serveStatic(res, pathname) {
  let filePath = join(publicDir, pathname === "/" ? "index.html" : pathname);
  const ext = extname(filePath).toLowerCase();

  if (!ext && existsSync(filePath + ".html")) {
    filePath += ".html";
  }

  if (!existsSync(filePath)) return false;

  const contentType = mimeTypes[ext] || "application/octet-stream";
  const content = await readFile(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    const db = await loadDb();
    res._db = db;

    const writeMethods = ["POST", "PATCH", "PUT", "DELETE"];
    const hasVersionHeader = req.headers["x-data-version"] !== undefined;
    if (writeMethods.includes(req.method) && requiresDataVersion(req.method, pathname) && !hasVersionHeader) {
      sendJson(res, 400, {
        error: "missing_data_version",
        message: "写操作必须携带 X-Data-Version 请求头"
      });
      return;
    }

    db._clientDataVersion = hasVersionHeader
      ? Number(req.headers["x-data-version"])
      : db._dataVersion;

    if (pathname.startsWith("/api/")) {
      if (pathname.startsWith("/api/sync")) {
        const handled = await handleSync(req, res, db, pathname);
        if (handled !== false) return;
      }
      if (pathname.startsWith("/api/users")) {
        const handled = handleUsers(req, res, db);
        if (handled !== false) return;
      }
      if (pathname.startsWith("/api/calendar")) {
        const handled = await handleCalendar(req, res, db, pathname);
        if (handled !== false) return;
      }
      if (pathname.startsWith("/api/projects")) {
        const handledReport = await handleReports(req, res, db, pathname);
        if (handledReport !== false) return;
        const handledReview = await handleReviews(req, res, db, pathname);
        if (handledReview !== false) return;
        const handledTimeline = await handleTimeline(req, res, db, pathname);
        if (handledTimeline !== false) return;
        const handledPhotos = await handlePhotos(req, res, db, pathname);
        if (handledPhotos !== false) return;
        const handledAudit = await handleAudit(req, res, db, pathname);
        if (handledAudit !== false) return;
        const handled = await handleProjects(req, res, db, pathname);
        if (handled !== false) return;
      }
      if (pathname.startsWith("/api/intakes")) {
        const handled = await handleIntakes(req, res, db, pathname);
        if (handled !== false) return;
      }
      if (pathname.startsWith("/api/materials")) {
        const handled = await handleMaterials(req, res, db, pathname);
        if (handled !== false) return;
      }
      if (pathname.startsWith("/api/templates")) {
        const handled = await handleTemplates(req, res, db, pathname);
        if (handled !== false) return;
      }
      return sendJson(res, 404, { error: "not_found" });
    }

    const served = await serveStatic(res, pathname);
    if (served) return;

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof DataVersionConflictError) {
      if (res._db) res._db._dataVersion = error.currentVersion;
      else res._dataVersion = error.currentVersion;
      sendJson(res, 409, {
        error: "data_version_conflict",
        message: "数据已被其他操作修改，请重新加载后重试",
        clientDataVersion: error.expectedVersion,
        serverDataVersion: error.currentVersion
      });
    } else {
      sendJson(res, 500, { error: error.message });
    }
  }
});

function requiresDataVersion(method, pathname) {
  if (pathname === "/api/projects/apply-template") return false;
  if (/^\/api\/projects\/[^/]+\/rollback-preview$/.test(pathname)) return false;
  if (pathname === "/api/sync/detect-conflicts") return false;

  if (method === "PATCH" || method === "PUT" || method === "DELETE") return true;

  if (method !== "POST") return false;
  if (pathname === "/api/projects") return true;
  if (pathname === "/api/intakes") return true;
  if (pathname === "/api/materials") return true;
  if (pathname === "/api/templates") return true;
  if (/^\/api\/projects\/[^/]+\/(timeline|photos|review|reports\/snapshots|sync-template|rollback)$/.test(pathname)) return true;
  if (pathname === "/api/sync/drafts") return true;
  if (pathname === "/api/sync/queue") return true;
  if (pathname === "/api/sync/execute") return true;
  if (pathname === "/api/sync/simulate-failure") return true;

  return false;
}

server.listen(port, () => {
  console.log(`Restoration studio app listening on http://localhost:${port}`);
});
