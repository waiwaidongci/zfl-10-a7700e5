import { parseBody, saveDb, sendJson } from "../db.js";

export async function handleIntakes(req, res, db, pathname) {
  if (req.method === "GET" && pathname === "/api/intakes") {
    return sendJson(res, 200, db.intakes);
  }

  if (req.method === "POST" && pathname === "/api/intakes") {
    const input = await parseBody(req);
    const intake = {
      id: `I-${Date.now()}`,
      status: "待修复",
      createdAt: new Date().toISOString().slice(0, 10),
      ...input
    };
    db.intakes.unshift(intake);
    await saveDb(db);
    return sendJson(res, 201, intake);
  }

  const match = pathname.match(/^\/api\/intakes\/([^/]+)$/);
  if (match) {
    const intake = db.intakes.find((item) => item.id === match[1]);
    if (!intake) return sendJson(res, 404, { error: "intake_not_found" });

    if (req.method === "GET") {
      return sendJson(res, 200, intake);
    }

    if (req.method === "PATCH") {
      Object.assign(intake, await parseBody(req));
      await saveDb(db);
      return sendJson(res, 200, intake);
    }

    if (req.method === "DELETE") {
      const idx = db.intakes.findIndex((item) => item.id === match[1]);
      if (idx > -1) db.intakes.splice(idx, 1);
      await saveDb(db);
      return sendJson(res, 200, { success: true });
    }
  }

  return false;
}
