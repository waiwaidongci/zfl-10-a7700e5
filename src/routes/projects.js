import { parseBody, saveDb, sendJson } from "../db.js";
import { createSystemRecord, createTemplateSyncRecord } from "../utils/timeline.js";
import { createSnapshot, applyTemplateToProject, compareTemplateWithSnapshot, archiveSnapshot } from "../utils/templateSnapshots.js";
import { validateProject } from "../utils/validation.js";
import { getViewer, filterProjectsByPermission } from "../utils/permissions.js";
import { recordAudit, ACTION_TYPES, SOURCES } from "../utils/audit.js";
import { deepClone } from "../utils/diff.js";
import { incrementVersion } from "../utils/sync.js";

function sanitizeProjectInput(input) {
  const out = {};
  if (input.title !== undefined) out.title = String(input.title).trim();
  if (input.era !== undefined) out.era = String(input.era).trim();
  if (input.damage !== undefined) out.damage = String(input.damage).trim();
  if (input.steps !== undefined) out.steps = String(input.steps).trim();
  if (input.materials !== undefined) out.materials = String(input.materials).trim();
  if (input.owner !== undefined) out.owner = String(input.owner).trim();
  if (input.dueDate !== undefined) out.dueDate = String(input.dueDate).trim();
  if (input.photos !== undefined) out.photos = String(input.photos || "").trim();
  if (input.status !== undefined) out.status = String(input.status).trim();
  if (input.templateId !== undefined) out.templateId = String(input.templateId).trim() || null;
  return out;
}

export async function handleProjects(req, res, db, pathname) {
  if (req.method === "GET" && pathname === "/api/projects") {
    const viewerId = req.headers["x-viewer-id"];
    const filtered = filterProjectsByPermission(db, viewerId);
    return sendJson(res, 200, filtered);
  }

  if (req.method === "POST" && pathname === "/api/projects/apply-template") {
    const input = await parseBody(req);
    const templateId = input.templateId;
    if (!templateId) {
      return sendJson(res, 400, { error: "template_id_required" });
    }
    const template = db.templates.find((t) => t.id === templateId);
    if (!template) {
      return sendJson(res, 404, { error: "template_not_found" });
    }
    const baseDate = input.baseDate ? new Date(input.baseDate) : new Date();
    const applied = applyTemplateToProject(template, { baseDate });
    return sendJson(res, 200, {
      snapshot: createSnapshot(template),
      applied
    });
  }

  if (req.method === "POST" && pathname === "/api/projects") {
    const rawInput = await parseBody(req);
    const intakeId = rawInput.intakeId ? String(rawInput.intakeId).trim() : null;
    const input = sanitizeProjectInput(rawInput);

    if (intakeId) {
      const intake = db.intakes.find((i) => i.id === intakeId);
      if (!intake) {
        return sendJson(res, 404, { error: "intake_not_found", errors: ["入库记录不存在"] });
      }
      if (intake.status === "已立项" || intake.projectId) {
        return sendJson(res, 400, { error: "intake_already_linked", errors: ["该入库记录已关联项目，不可重复立项"] });
      }
    }

    let templateSnapshot = null;
    if (input.templateId) {
      const template = db.templates.find((t) => t.id === input.templateId);
      if (template) {
        templateSnapshot = createSnapshot(template);
        const applied = applyTemplateToProject(template);
        if (!input.steps || !input.steps.trim()) input.steps = applied.steps;
        if (!input.materials || !input.materials.trim()) input.materials = applied.materials;
        if (!input.dueDate || !input.dueDate.trim()) input.dueDate = applied.dueDate;
        delete input.templateId;
      }
    }

    const errors = validateProject(input, { templates: db.templates });
    if (errors.length > 0) {
      return sendJson(res, 400, { error: "validation_failed", errors });
    }

    const viewerId = req.headers["x-viewer-id"];
    const viewer = getViewer(db, viewerId);

    const project = {
      id: `R-${Date.now()}`,
      status: "进行中",
      updatedAt: new Date().toISOString().slice(0, 10),
      version: 1,
      reviewRecords: [],
      timelineRecords: [],
      photoArchive: { before: [], during: [], after: [] },
      templateSnapshot,
      ...input
    };
    db.projects.unshift(project);

    if (intakeId) {
      const intake = db.intakes.find((item) => item.id === intakeId);
      if (intake) {
        intake.status = "已立项";
        intake.projectId = project.id;
      }
    }

    recordAudit(db, {
      projectId: project.id,
      actionType: ACTION_TYPES.PROJECT_CREATE,
      operator: viewer ? viewer.name : "未知用户",
      operatorId: viewerId || "",
      source: SOURCES.API,
      beforeState: null,
      afterState: deepClone(project),
      note: templateSnapshot ? `从模板 ${templateSnapshot.templateName} 创建` : (intakeId ? `从入库记录 ${intakeId} 创建` : "")
    });

    await saveDb(db);
    return sendJson(res, 201, project);
  }

  const match = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (match && req.method === "PATCH") {
    const viewerId = req.headers["x-viewer-id"];
    const viewer = getViewer(db, viewerId);

    const project = db.projects.find((item) => item.id === match[1]);
    if (!project) return sendJson(res, 404, { error: "project_not_found" });

    if (!viewer) return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
    if (viewer.role !== "admin" && project.owner !== viewer.name) {
      return sendJson(res, 403, { error: "forbidden", message: "无权修改该项目" });
    }

    const rawBody = await parseBody(req);
    const clientVersion = rawBody.clientVersion;
    if (clientVersion !== undefined && clientVersion < project.version) {
      return sendJson(res, 409, {
        error: "version_conflict",
        message: "服务端版本已更新，请同步后再修改",
        clientVersion,
        serverVersion: project.version,
        serverProject: deepClone(project)
      });
    }

    const oldStatus = project.status;
    const beforeState = deepClone(project);
    const body = sanitizeProjectInput(rawBody);

    if (body.templateId) {
      if (project.templateSnapshot) {
        delete body.templateId;
      } else {
        const template = db.templates.find((t) => t.id === body.templateId);
        if (template) {
          project.templateSnapshot = createSnapshot(template);
        }
        delete body.templateId;
      }
    }

    incrementVersion(project);
    Object.assign(project, body, { updatedAt: new Date().toISOString().slice(0, 10) });

    const statusChanged = body.status && body.status !== oldStatus;
    if (statusChanged) {
      if (!project.timelineRecords) project.timelineRecords = [];
      project.timelineRecords.push(createSystemRecord({
        operator: viewer ? viewer.name : "未知用户",
        operatorId: viewerId || "",
        oldStatus,
        newStatus: body.status
      }));
    }

    const actionType = statusChanged ? ACTION_TYPES.STATUS_CHANGE : ACTION_TYPES.PROJECT_UPDATE;
    recordAudit(db, {
      projectId: project.id,
      actionType,
      operator: viewer ? viewer.name : "未知用户",
      operatorId: viewerId || "",
      source: SOURCES.API,
      beforeState,
      afterState: deepClone(project)
    });

    await saveDb(db);
    return sendJson(res, 200, project);
  }

  const statusMatch = pathname.match(/^\/api\/projects\/([^/]+)\/template-status$/);
  if (statusMatch && req.method === "GET") {
    const projectId = statusMatch[1];
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) return sendJson(res, 404, { error: "project_not_found" });

    const snapshot = project.templateSnapshot;
    if (!snapshot || !snapshot.templateId) {
      return sendJson(res, 200, {
        hasSnapshot: false,
        hasUpdate: false,
        hasChanges: false,
        currentTemplate: null,
        snapshotVersion: 0,
        currentVersion: 0
      });
    }

    const template = db.templates.find((t) => t.id === snapshot.templateId);
    if (!template) {
      return sendJson(res, 200, {
        hasSnapshot: true,
        templateDeleted: true,
        hasUpdate: false,
        hasChanges: false,
        snapshotVersion: snapshot.templateVersion || 0,
        currentVersion: 0
      });
    }

    const comparison = compareTemplateWithSnapshot(template, snapshot);
    return sendJson(res, 200, {
      hasSnapshot: true,
      templateDeleted: false,
      hasUpdate: comparison?.isNewer || false,
      hasChanges: comparison?.hasChanges || false,
      snapshotVersion: snapshot.templateVersion || 0,
      currentVersion: template.version,
      templateId: template.id,
      templateName: template.name,
      appliedAt: snapshot.appliedAt
    });
  }

  const diffMatch = pathname.match(/^\/api\/projects\/([^/]+)\/template-diff$/);
  if (diffMatch && req.method === "GET") {
    const viewerId = req.headers["x-viewer-id"];
    const viewer = getViewer(db, viewerId);
    if (!viewer) return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
    if (viewer.role !== "admin") {
      return sendJson(res, 403, { error: "forbidden", message: "仅管理员可查看模板差异" });
    }

    const projectId = diffMatch[1];
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) return sendJson(res, 404, { error: "project_not_found" });

    const snapshot = project.templateSnapshot;
    if (!snapshot || !snapshot.templateId) {
      return sendJson(res, 400, { error: "no_template_snapshot", message: "项目未应用模板" });
    }

    const template = db.templates.find((t) => t.id === snapshot.templateId);
    if (!template) {
      return sendJson(res, 404, { error: "template_not_found", message: "关联模板已被删除" });
    }

    const comparison = compareTemplateWithSnapshot(template, snapshot);
    return sendJson(res, 200, comparison);
  }

  const syncMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sync-template$/);
  if (syncMatch && req.method === "POST") {
    const viewerId = req.headers["x-viewer-id"];
    const viewer = getViewer(db, viewerId);
    if (!viewer) return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
    if (viewer.role !== "admin") {
      return sendJson(res, 403, { error: "forbidden", message: "仅管理员可同步模板更新" });
    }

    const projectId = syncMatch[1];
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) return sendJson(res, 404, { error: "project_not_found" });

    const snapshot = project.templateSnapshot;
    if (!snapshot || !snapshot.templateId) {
      return sendJson(res, 400, { error: "no_template_snapshot", message: "项目未应用模板" });
    }

    const template = db.templates.find((t) => t.id === snapshot.templateId);
    if (!template) {
      return sendJson(res, 404, { error: "template_not_found", message: "关联模板已被删除" });
    }

    const input = await parseBody(req);
    const selectedFields = input.fields || {};

    const beforeState = deepClone(project);
    const oldVersion = snapshot.templateVersion || 0;
    const newVersion = template.version;

    if (!project.templateSnapshotHistory) project.templateSnapshotHistory = [];
    project.templateSnapshotHistory.unshift(
      archiveSnapshot(deepClone(snapshot), {
        syncedFrom: oldVersion,
        operator: viewer.name,
        operatorId: viewer.id
      })
    );

    const syncedFields = {};
    const newSnapshot = createSnapshot(template);

    if (selectedFields.steps) {
      project.steps = template.steps;
      syncedFields.steps = true;
    }
    if (selectedFields.materials) {
      project.materials = template.materials;
      syncedFields.materials = true;
    }
    if (selectedFields.estimatedDays) {
      const daysDiff = (template.estimatedDays || 0) - (snapshot.estimatedDays || 0);
      if (daysDiff !== 0 && project.dueDate) {
        const base = new Date(project.dueDate);
        base.setDate(base.getDate() + daysDiff);
        project.dueDate = base.toISOString().slice(0, 10);
      }
      syncedFields.estimatedDays = true;
    }
    if (selectedFields.reviewRequired) {
      project.reviewRequired = template.reviewRequired !== false;
      syncedFields.reviewRequired = true;
    }
    if (selectedFields.reviewNotes) {
      syncedFields.reviewNotes = true;
    }

    Object.assign(snapshot, newSnapshot);
    snapshot.appliedAt = new Date().toISOString().slice(0, 10);
    snapshot.syncedFields = syncedFields;

    if (!project.timelineRecords) project.timelineRecords = [];
    project.timelineRecords.push(
      createTemplateSyncRecord({
        operator: viewer.name,
        operatorId: viewer.id,
        templateName: template.name,
        oldVersion,
        newVersion,
        syncedFields
      })
    );

    incrementVersion(project);
    project.updatedAt = new Date().toISOString().slice(0, 10);

    const fieldLabels = [];
    if (syncedFields.steps) fieldLabels.push("修复步骤");
    if (syncedFields.materials) fieldLabels.push("使用材料");
    if (syncedFields.estimatedDays) fieldLabels.push("预计工期");
    if (syncedFields.reviewRequired || syncedFields.reviewNotes) fieldLabels.push("复核要求");

    recordAudit(db, {
      projectId: project.id,
      actionType: ACTION_TYPES.TEMPLATE_SYNC,
      operator: viewer.name,
      operatorId: viewer.id,
      source: SOURCES.SYNC,
      beforeState,
      afterState: deepClone(project),
      note: `模板"${template.name}" v${oldVersion} → v${newVersion}，同步字段：${fieldLabels.join("、") || "无"}`,
      relatedId: template.id
    });

    await saveDb(db);
    return sendJson(res, 200, {
      success: true,
      project,
      syncedFields,
      oldVersion,
      newVersion
    });
  }

  return false;
}
