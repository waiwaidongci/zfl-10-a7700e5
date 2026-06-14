import { parseBody, saveDb, sendJson } from "../db.js";
import { createSystemRecord } from "../utils/timeline.js";

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
      reviewRecords: [],
      timelineRecords: [],
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
    const oldStatus = project.status;
    const body = await parseBody(req);
    Object.assign(project, body, { updatedAt: new Date().toISOString().slice(0, 10) });

    if (body.status && body.status !== oldStatus) {
      const viewerId = req.headers["x-viewer-id"];
      const viewer = db.users.find((u) => u.id === viewerId);
      if (!project.timelineRecords) project.timelineRecords = [];
      project.timelineRecords.push(createSystemRecord({
        operator: viewer ? viewer.name : "未知用户",
        operatorId: viewerId || "",
        oldStatus,
        newStatus: body.status
      }));
    }

    await saveDb(db);
    return sendJson(res, 200, project);
  }

  return false;
}
