import { parseBody, saveDb, sendJson } from "../db.js";

export async function handleProjects(req, res, db, pathname) {
  if (req.method === "GET" && pathname === "/api/projects") {
    return sendJson(res, 200, db.projects);
  }

  if (req.method === "POST" && pathname === "/api/projects") {
    const input = await parseBody(req);
    const project = {
      id: `R-${Date.now()}`,
      status: "进行中",
      updatedAt: new Date().toISOString().slice(0, 10),
      ...input
    };
    db.projects.unshift(project);
    await saveDb(db);
    return sendJson(res, 201, project);
  }

  const match = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (match && req.method === "PATCH") {
    const project = db.projects.find((item) => item.id === match[1]);
    if (!project) return sendJson(res, 404, { error: "project_not_found" });
    Object.assign(project, await parseBody(req), { updatedAt: new Date().toISOString().slice(0, 10) });
    await saveDb(db);
    return sendJson(res, 200, project);
  }

  return false;
}
