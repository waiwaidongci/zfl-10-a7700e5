import { parseBody, saveDb, sendJson } from "../db.js";
import { createTimelineRecord, validateTimelineRecord, sortRecords } from "../utils/timeline.js";
import { incrementVersion } from "../utils/sync.js";
import { deepClone } from "../utils/diff.js";
import { getViewer, filterProjectsByPermission } from "../utils/permissions.js";

export async function handleTimeline(req, res, db, pathname) {
  const listMatch = pathname.match(/^\/api\/projects\/([^/]+)\/timeline$/);
  const recordMatch = pathname.match(/^\/api\/projects\/([^/]+)\/timeline\/([^/]+)$/);

  const viewerId = req.headers["x-viewer-id"];
  const viewer = getViewer(db, viewerId);

  function canAccessProject(projectId) {
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) return null;
    if (!viewer) return false;
    if (viewer.role === "admin") return project;
    if (project.owner === viewer.name) return project;
    return false;
  }

  if (listMatch && req.method === "GET") {
    const project = canAccessProject(listMatch[1]);
    if (project === null) return sendJson(res, 404, { error: "project_not_found", message: "项目不存在" });
    if (project === false) return sendJson(res, 403, { error: "forbidden", message: "无权查看该项目" });
    return sendJson(res, 200, sortRecords(project.timelineRecords || []));
  }

  if (listMatch && req.method === "POST") {
    if (!viewer) return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });

    const project = canAccessProject(listMatch[1]);
    if (project === null) return sendJson(res, 404, { error: "project_not_found", message: "项目不存在" });
    if (project === false) return sendJson(res, 403, { error: "forbidden", message: "无权操作该项目" });

    const input = await parseBody(req);

    if (input.recordId) {
      const existingRecord = (project.timelineRecords || []).find(r => r.id === input.recordId);
      if (existingRecord && input.clientVersion !== undefined && input.clientVersion < existingRecord.version) {
        return sendJson(res, 409, {
          error: "version_conflict",
          message: "该记录已被修改，请同步后再操作",
          clientVersion: input.clientVersion,
          serverVersion: existingRecord.version,
          serverRecord: deepClone(existingRecord)
        });
      }
    }

    const errors = validateTimelineRecord(input);
    if (errors.length > 0) {
      return sendJson(res, 400, { error: "validation_failed", message: "输入校验失败", errors });
    }

    const record = createTimelineRecord({
      type: "manual",
      operator: input.operator.trim(),
      operatorId: viewer.id,
      date: input.date.trim(),
      steps: input.steps.trim(),
      materials: (input.materials || "").trim(),
      notes: (input.notes || "").trim(),
      photoUrl: (input.photoUrl || "").trim()
    });

    if (!project.timelineRecords) project.timelineRecords = [];
    project.timelineRecords.push(record);
    incrementVersion(project);
    project.updatedAt = new Date().toISOString().slice(0, 10);

    await saveDb(db);
    return sendJson(res, 201, { project, record });
  }

  if (recordMatch && req.method === "DELETE") {
    if (!viewer || viewer.role !== "admin") {
      return sendJson(res, 403, { error: "forbidden", message: "仅管理员可删除记录" });
    }

    const project = canAccessProject(recordMatch[1]);
    if (project === null) return sendJson(res, 404, { error: "project_not_found", message: "项目不存在" });
    if (project === false) return sendJson(res, 403, { error: "forbidden", message: "无权操作该项目" });

    const idx = (project.timelineRecords || []).findIndex((r) => r.id === recordMatch[2]);
    if (idx === -1) return sendJson(res, 404, { error: "record_not_found", message: "记录不存在" });

    const [removed] = project.timelineRecords.splice(idx, 1);
    project.updatedAt = new Date().toISOString().slice(0, 10);

    await saveDb(db);
    return sendJson(res, 200, { removed });
  }

  return false;
}
