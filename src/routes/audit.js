import { parseBody, saveDb, sendJson } from "../db.js";
import { getViewer } from "../utils/permissions.js";
import { getProjectAuditLogs, getAuditLogById } from "../utils/audit.js";
import {
  canRollback,
  validateRollbackTarget,
  computeRollbackPreview,
  applyRollback
} from "../utils/rollback.js";

export async function handleAudit(req, res, db, pathname) {
  const listMatch = pathname.match(/^\/api\/projects\/([^/]+)\/audit-logs$/);
  const detailMatch = pathname.match(/^\/api\/projects\/([^/]+)\/audit-logs\/([^/]+)$/);
  const rollbackMatch = pathname.match(/^\/api\/projects\/([^/]+)\/rollback$/);
  const rollbackPreviewMatch = pathname.match(/^\/api\/projects\/([^/]+)\/rollback-preview$/);

  const viewerId = req.headers["x-viewer-id"];
  const viewer = getViewer(db, viewerId);

  if (listMatch && req.method === "GET") {
    return await handleListLogs(req, res, db, listMatch[1], viewer);
  }

  if (detailMatch && req.method === "GET") {
    return await handleLogDetail(req, res, db, detailMatch[1], detailMatch[2], viewer);
  }

  if (rollbackPreviewMatch && req.method === "POST") {
    return await handleRollbackPreview(req, res, db, rollbackPreviewMatch[1], viewer);
  }

  if (rollbackMatch && req.method === "POST") {
    return await handleRollback(req, res, db, rollbackMatch[1], viewer);
  }

  return false;
}

async function handleListLogs(req, res, db, projectId, viewer) {
  const project = db.projects.find(p => p.id === projectId);
  if (!project) {
    return sendJson(res, 404, { error: "project_not_found" });
  }

  if (!viewer) {
    return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
  }

  if (viewer.role !== "admin" && project.owner !== viewer.name) {
    return sendJson(res, 403, { error: "forbidden", message: "无权查看该项目的审计记录" });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const actionType = url.searchParams.get("actionType");
  const limit = parseInt(url.searchParams.get("limit"), 10) || 0;

  const logs = getProjectAuditLogs(db, projectId, {
    actionType: actionType || undefined,
    limit: limit > 0 ? limit : undefined
  });

  const safeLogs = logs.map(log => ({
    id: log.id,
    projectId: log.projectId,
    actionType: log.actionType,
    actionLabel: log.actionLabel,
    operator: log.operator,
    operatorId: log.operatorId,
    source: log.source,
    timestamp: log.timestamp,
    summary: log.summary,
    changes: log.changes,
    note: log.note,
    relatedId: log.relatedId,
    hasStateSnapshot: !!log.afterState
  }));

  return sendJson(res, 200, safeLogs);
}

async function handleLogDetail(req, res, db, projectId, logId, viewer) {
  const project = db.projects.find(p => p.id === projectId);
  if (!project) {
    return sendJson(res, 404, { error: "project_not_found" });
  }

  if (!viewer) {
    return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
  }

  if (viewer.role !== "admin" && project.owner !== viewer.name) {
    return sendJson(res, 403, { error: "forbidden", message: "无权查看该审计记录详情" });
  }

  const log = getAuditLogById(db, logId);
  if (!log) {
    return sendJson(res, 404, { error: "audit_log_not_found" });
  }

  if (log.projectId !== projectId) {
    return sendJson(res, 404, { error: "audit_log_not_found" });
  }

  return sendJson(res, 200, log);
}

async function handleRollbackPreview(req, res, db, projectId, viewer) {
  if (!viewer) {
    return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
  }

  if (!canRollback(viewer)) {
    return sendJson(res, 403, { error: "forbidden", message: "仅管理员可执行回滚操作" });
  }

  const project = db.projects.find(p => p.id === projectId);
  if (!project) {
    return sendJson(res, 404, { error: "project_not_found" });
  }

  const input = await parseBody(req);
  const targetLogId = input.targetLogId;

  if (!targetLogId) {
    return sendJson(res, 400, { error: "target_log_id_required", message: "请指定目标审计记录ID" });
  }

  const validation = validateRollbackTarget(db, projectId, targetLogId);
  if (!validation.valid) {
    return sendJson(res, 400, { error: "invalid_target", message: validation.errors.join("；") });
  }

  const preview = computeRollbackPreview(project, validation.targetLog);

  return sendJson(res, 200, preview);
}

async function handleRollback(req, res, db, projectId, viewer) {
  if (!viewer) {
    return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
  }

  if (!canRollback(viewer)) {
    return sendJson(res, 403, { error: "forbidden", message: "仅管理员可执行回滚操作" });
  }

  const project = db.projects.find(p => p.id === projectId);
  if (!project) {
    return sendJson(res, 404, { error: "project_not_found" });
  }

  const input = await parseBody(req);
  const targetLogId = input.targetLogId;
  const reason = input.reason || "";

  if (!targetLogId) {
    return sendJson(res, 400, { error: "target_log_id_required", message: "请指定目标审计记录ID" });
  }

  const validation = validateRollbackTarget(db, projectId, targetLogId);
  if (!validation.valid) {
    return sendJson(res, 400, { error: "invalid_target", message: validation.errors.join("；") });
  }

  const result = applyRollback(db, projectId, targetLogId, viewer.name, viewer.id);

  if (!result.success) {
    return sendJson(res, 400, { error: "rollback_failed", message: result.errors.join("；") });
  }

  if (reason && result.rollbackLog) {
    result.rollbackLog.note = reason ? `${reason} —— ${result.rollbackLog.note}` : result.rollbackLog.note;
  }

  await saveDb(db);

  return sendJson(res, 200, {
    success: true,
    project: result.project,
    rollbackLog: {
      id: result.rollbackLog.id,
      timestamp: result.rollbackLog.timestamp,
      summary: result.rollbackLog.summary
    }
  });
}
