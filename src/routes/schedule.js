import { sendJson, parseBody, saveDb } from "../db.js";
import { getViewer, isOverdue, isPendingReview } from "../utils/permissions.js";
import { calculateSchedule, validateScheduleChange, detectConflicts, getEstimatedDays, parseDate, formatDate } from "../utils/scheduling.js";
import { recordAudit, ACTION_TYPES, SOURCES } from "../utils/audit.js";
import { deepClone } from "../utils/diff.js";
import { incrementVersion } from "../utils/sync.js";

export async function handleSchedule(req, res, db, pathname) {
  if (req.method === "GET" && pathname === "/api/schedule") {
    const viewerId = req.headers["x-viewer-id"];
    const viewer = getViewer(db, viewerId);
    if (!viewer) return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const weeksParam = parseInt(url.searchParams.get("weeks") || "6", 10);
    const weeksCount = Math.max(1, Math.min(12, weeksParam));

    const schedule = calculateSchedule(db, viewerId, weeksCount);
    return sendJson(res, 200, schedule);
  }

  if (req.method === "POST" && pathname === "/api/schedule/validate") {
    const viewerId = req.headers["x-viewer-id"];
    const viewer = getViewer(db, viewerId);
    if (!viewer) return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
    if (viewer.role !== "admin") {
      return sendJson(res, 403, { error: "forbidden", message: "仅管理员可调整排程" });
    }

    const input = await parseBody(req);
    const { projectId, newOwnerId, newDueDate } = input;

    const project = db.projects.find(p => p.id === projectId);
    if (!project) return sendJson(res, 404, { error: "project_not_found", message: "项目不存在" });

    const ownerName = newOwnerId
      ? db.users.find(u => u.id === newOwnerId)?.name
      : project.owner;

    const validation = validateScheduleChange(
      project,
      ownerName,
      newDueDate || project.dueDate,
      db
    );

    const conflicts = detectConflicts(
      db.projects.map(p => p.id === projectId
        ? { ...p, owner: ownerName || p.owner, dueDate: newDueDate || p.dueDate }
        : p
      ),
      db.templates,
      db.materials
    );

    return sendJson(res, 200, {
      validation,
      conflicts,
      currentProject: {
        id: project.id,
        title: project.title,
        owner: project.owner,
        dueDate: project.dueDate,
        status: project.status
      },
      proposedChange: {
        newOwner: ownerName,
        newDueDate,
        estimatedDays: getEstimatedDays(project, db.templates)
      }
    });
  }

  if (req.method === "POST" && pathname === "/api/schedule/adjust") {
    const viewerId = req.headers["x-viewer-id"];
    const viewer = getViewer(db, viewerId);
    if (!viewer) return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
    if (viewer.role !== "admin") {
      return sendJson(res, 403, { error: "forbidden", message: "仅管理员可调整排程" });
    }

    const input = await parseBody(req);
    const { projectId, newOwnerId, newDueDate, force = false } = input;

    const project = db.projects.find(p => p.id === projectId);
    if (!project) return sendJson(res, 404, { error: "project_not_found", message: "项目不存在" });

    const oldOwner = project.owner;
    const oldDueDate = project.dueDate;

    let newOwnerName = oldOwner;
    if (newOwnerId) {
      const newUser = db.users.find(u => u.id === newOwnerId);
      if (!newUser || newUser.role !== "worker") {
        return sendJson(res, 400, { error: "invalid_owner", message: "负责人必须是修复人员" });
      }
      newOwnerName = newUser.name;
    }

    const finalDueDate = newDueDate || oldDueDate;

    const validation = validateScheduleChange(project, newOwnerName, finalDueDate, db);
    if (!validation.isValid && !force) {
      return sendJson(res, 400, {
        error: "validation_failed",
        message: "排程调整存在错误",
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    if (validation.warnings.length > 0 && !force) {
      return sendJson(res, 202, {
        warning: "has_warnings",
        message: "排程调整存在风险警告，请确认是否继续",
        warnings: validation.warnings,
        proposedChange: {
          projectId,
          projectTitle: project.title,
          oldOwner,
          newOwner: newOwnerName,
          oldDueDate,
          newDueDate: finalDueDate
        }
      });
    }

    const beforeState = deepClone(project);

    incrementVersion(project);

    if (newOwnerId) {
      const newUser = db.users.find(u => u.id === newOwnerId);
      if (newUser) project.owner = newUser.name;
    }
    if (newDueDate) {
      project.dueDate = newDueDate;
    }
    project.updatedAt = new Date().toISOString().slice(0, 10);

    const changes = [];
    if (project.owner !== oldOwner) {
      changes.push({
        field: "owner",
        label: "负责人",
        oldValue: oldOwner,
        newValue: project.owner,
        type: "modify"
      });
    }
    if (project.dueDate !== oldDueDate) {
      changes.push({
        field: "dueDate",
        label: "预计完成日期",
        oldValue: oldDueDate,
        newValue: project.dueDate,
        type: "modify"
      });
    }

    const changeSummary = changes.length > 0
      ? `${changes.length} 个字段变更：${changes.map(c => c.label).join("、")}`
      : "无实际变更";

    recordAudit(db, {
      projectId: project.id,
      actionType: ACTION_TYPES.PROJECT_UPDATE,
      operator: viewer.name,
      operatorId: viewer.id,
      source: SOURCES.SCHEDULE,
      beforeState,
      afterState: deepClone(project),
      note: `排程调整：${changeSummary}`,
      changes
    });

    await saveDb(db);

    const updatedSchedule = calculateSchedule(db, viewerId, 6);

    return sendJson(res, 200, {
      success: true,
      message: "排程调整已保存",
      project: {
        id: project.id,
        title: project.title,
        owner: project.owner,
        dueDate: project.dueDate,
        status: project.status,
        version: project.version
      },
      changes,
      updatedSchedule
    });
  }

  if (req.method === "GET" && pathname === "/api/schedule/conflicts") {
    const viewerId = req.headers["x-viewer-id"];
    const viewer = getViewer(db, viewerId);
    if (!viewer) return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });

    const conflicts = detectConflicts(db.projects, db.templates, db.materials);

    const filteredConflicts = viewer.role === "admin"
      ? conflicts
      : conflicts.filter(c => c.worker === viewer.name || c.projectId);

    return sendJson(res, 200, {
      conflicts: filteredConflicts,
      stats: {
        total: filteredConflicts.length,
        danger: filteredConflicts.filter(c => c.severity === "danger").length,
        warning: filteredConflicts.filter(c => c.severity === "warning").length,
        info: filteredConflicts.filter(c => c.severity === "info").length
      }
    });
  }

  return false;
}
