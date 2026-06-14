import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { loadDb, sendJson } from "./src/db.js";
import { handleUsers } from "./src/routes/users.js";
import { handleProjects } from "./src/routes/projects.js";
import { handleIntakes } from "./src/routes/intakes.js";
import { handleMaterials } from "./src/routes/materials.js";
import { handleReviews } from "./src/routes/reviews.js";
import { handleTimeline } from "./src/routes/timeline.js";
import { handlePhotos } from "./src/routes/photos.js";

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

    if (pathname.startsWith("/api/")) {
      if (pathname.startsWith("/api/users")) {
        const handled = handleUsers(req, res, db);
        if (handled !== false) return;
      }
      if (pathname.startsWith("/api/projects")) {
        const handledReview = await handleReviews(req, res, db, pathname);
        if (handledReview !== false) return;
        const handledTimeline = await handleTimeline(req, res, db, pathname);
        if (handledTimeline !== false) return;
        const handledPhotos = await handlePhotos(req, res, db, pathname);
        if (handledPhotos !== false) return;
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
      return sendJson(res, 404, { error: "not_found" });
    }

    const served = await serveStatic(res, pathname);
    if (served) return;

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Restoration studio app listening on http://localhost:${port}`);
});
