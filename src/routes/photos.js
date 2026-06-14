import { parseBody, saveDb, sendJson } from "../db.js";

const VALID_STAGES = ["before", "during", "after"];

export async function handlePhotos(req, res, db, pathname) {
  const photosMatch = pathname.match(/^\/api\/projects\/([^/]+)\/photos$/);
  if (!photosMatch) return false;

  const projectId = photosMatch[1];
  const project = db.projects.find((item) => item.id === projectId);
  if (!project) return sendJson(res, 404, { error: "project_not_found" });

  if (!project.photoArchive) {
    project.photoArchive = { before: [], during: [], after: [] };
  }

  if (req.method === "GET") {
    return sendJson(res, 200, project.photoArchive);
  }

  if (req.method === "POST") {
    const input = await parseBody(req);
    const { stage, url } = input;

    if (!stage || !VALID_STAGES.includes(stage)) {
      return sendJson(res, 400, { error: "invalid_stage", message: "阶段必须为 before、during 或 after" });
    }
    if (!url || url.trim() === "") {
      return sendJson(res, 400, { error: "invalid_url", message: "照片链接不能为空" });
    }
    try {
      new URL(url.trim());
    } catch {
      return sendJson(res, 400, { error: "invalid_url", message: "照片链接格式不正确" });
    }

    project.photoArchive[stage].push(url.trim());
    project.updatedAt = new Date().toISOString().slice(0, 10);
    await saveDb(db);
    return sendJson(res, 201, project.photoArchive);
  }

  if (req.method === "DELETE") {
    const input = await parseBody(req);
    const { stage, index } = input;

    if (!stage || !VALID_STAGES.includes(stage)) {
      return sendJson(res, 400, { error: "invalid_stage", message: "阶段必须为 before、during 或 after" });
    }
    if (typeof index !== "number" || index < 0 || index >= project.photoArchive[stage].length) {
      return sendJson(res, 400, { error: "invalid_index", message: "照片索引无效" });
    }

    project.photoArchive[stage].splice(index, 1);
    project.updatedAt = new Date().toISOString().slice(0, 10);
    await saveDb(db);
    return sendJson(res, 200, project.photoArchive);
  }

  return false;
}
