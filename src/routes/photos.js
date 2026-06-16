import { parseBody, saveDb, sendJson } from "../db.js";
import { getViewer } from "../utils/permissions.js";
import { incrementVersion } from "../utils/sync.js";
import { recordAudit, ACTION_TYPES, SOURCES } from "../utils/audit.js";
import { deepClone } from "../utils/diff.js";

const VALID_STAGES = ["before", "during", "after"];

export async function handlePhotos(req, res, db, pathname) {
  const photosMatch = pathname.match(/^\/api\/projects\/([^/]+)\/photos$/);
  if (!photosMatch) return false;

  const projectId = photosMatch[1];
  const viewerId = req.headers["x-viewer-id"];
  const viewer = getViewer(db, viewerId);

  const project = db.projects.find((item) => item.id === projectId);
  if (!project) return sendJson(res, 404, { error: "project_not_found" });

  if (!viewer) return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
  if (viewer.role !== "admin" && project.owner !== viewer.name) {
    return sendJson(res, 403, { error: "forbidden", message: "无权操作该项目的照片" });
  }

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

    const beforeState = deepClone(project);
    project.photoArchive[stage].push(url.trim());
    incrementVersion(project);
    project.updatedAt = new Date().toISOString().slice(0, 10);

    recordAudit(db, {
      projectId,
      actionType: ACTION_TYPES.PROJECT_UPDATE,
      operator: viewer.name,
      operatorId: viewerId,
      source: SOURCES.API,
      beforeState,
      afterState: deepClone(project),
      note: `添加${stage === "before" ? "修复前" : stage === "during" ? "修复中" : "修复后"}照片`
    });

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

    const beforeState = deepClone(project);
    project.photoArchive[stage].splice(index, 1);
    incrementVersion(project);
    project.updatedAt = new Date().toISOString().slice(0, 10);

    recordAudit(db, {
      projectId,
      actionType: ACTION_TYPES.PROJECT_UPDATE,
      operator: viewer.name,
      operatorId: viewerId,
      source: SOURCES.API,
      beforeState,
      afterState: deepClone(project),
      note: `删除${stage === "before" ? "修复前" : stage === "during" ? "修复中" : "修复后"}照片（第 ${index + 1} 张）`
    });

    await saveDb(db);
    return sendJson(res, 200, project.photoArchive);
  }

  return false;
}
