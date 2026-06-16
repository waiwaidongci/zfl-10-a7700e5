import { parseBody, saveDb, sendJson } from "../db.js";
import { getViewer } from "../utils/permissions.js";
import { deepClone } from "../utils/diff.js";
import { recordAudit, ACTION_TYPES, SOURCES } from "../utils/audit.js";
import { createSystemRecord } from "../utils/timeline.js";
import { validateMaterialUsages, checkStockSufficiency, consumeMaterials, restoreMaterials, formatMaterialUsagesText } from "../utils/materials.js";
import {
  createProjectDraft,
  createTimelineDraft,
  createPhotoDraft,
  detectProjectConflict,
  detectTimelineConflict,
  detectPhotosConflict,
  resolveConflict,
  resolvePhotosConflict,
  addToSyncQueue,
  removeFromSyncQueue,
  getPendingSyncItems,
  getDraftsByUser,
  saveDraft,
  deleteDraft,
  incrementVersion
} from "../utils/sync.js";

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
  return out;
}

function sanitizeTimelineInput(input) {
  const out = {};
  if (input.id !== undefined) out.id = String(input.id).trim();
  if (input.operator !== undefined) out.operator = String(input.operator).trim();
  if (input.date !== undefined) out.date = String(input.date).trim();
  if (input.steps !== undefined) out.steps = String(input.steps).trim();
  if (input.materials !== undefined) out.materials = String(input.materials || "").trim();
  if (input.notes !== undefined) out.notes = String(input.notes || "").trim();
  if (input.photoUrl !== undefined) out.photoUrl = String(input.photoUrl || "").trim();
  if (input.recordId !== undefined) out.recordId = String(input.recordId).trim();
  if (input.materialUsages !== undefined && Array.isArray(input.materialUsages)) {
    out.materialUsages = input.materialUsages.map(u => ({
      materialId: String(u.materialId || "").trim(),
      quantity: Number(u.quantity) || 0
    })).filter(u => u.materialId && u.quantity > 0);
  }
  return out;
}

export async function handleSync(req, res, db, pathname) {
  const viewerId = req.headers["x-viewer-id"];
  const viewer = getViewer(db, viewerId);

  if (pathname === "/api/sync/drafts" && req.method === "GET") {
    if (!viewer) return sendJson(res, 401, { error: "unauthorized" });
    const drafts = getDraftsByUser(db, viewerId);
    return sendJson(res, 200, drafts);
  }

  if (pathname === "/api/sync/drafts" && req.method === "POST") {
    if (!viewer) return sendJson(res, 401, { error: "unauthorized" });
    const input = await parseBody(req);
    const { type, projectId, data } = input;

    let draft;
    if (type === "project") {
      const sanitized = sanitizeProjectInput(data);
      draft = createProjectDraft(sanitized, viewerId);
    } else if (type === "timeline" && projectId) {
      const sanitized = sanitizeTimelineInput(data);
      draft = createTimelineDraft(projectId, sanitized, viewerId);
    } else if (type === "photos" && projectId) {
      draft = createPhotoDraft(projectId, data, viewerId);
    } else {
      return sendJson(res, 400, { error: "invalid_draft_type" });
    }

    saveDraft(db, draft);
    await saveDb(db);
    return sendJson(res, 201, draft);
  }

  const draftMatch = pathname.match(/^\/api\/sync\/drafts\/([^/]+)$/);
  if (draftMatch) {
    const draftId = draftMatch[1];
    const draft = db.offlineDrafts.find(d => d.id === draftId);

    if (!draft) return sendJson(res, 404, { error: "draft_not_found" });
    if (draft.createdBy !== viewerId && viewer?.role !== "admin") {
      return sendJson(res, 403, { error: "forbidden" });
    }

    if (req.method === "GET") {
      return sendJson(res, 200, draft);
    }

    if (req.method === "PUT") {
      const input = await parseBody(req);
      let changed = false;
      if (input.data) {
        draft.data = deepClone(input.data);
        changed = true;
      }
      if (input.operation !== undefined) {
        draft.operation = input.operation;
        changed = true;
      }
      if (input.entityId !== undefined) {
        draft.entityId = input.entityId;
        changed = true;
      }
      if (input.baseVersion !== undefined) {
        draft.baseVersion = input.baseVersion;
        changed = true;
      }
      if (changed) {
        draft.updatedAt = new Date().toISOString();
        saveDraft(db, draft);
        await saveDb(db);
      }
      return sendJson(res, 200, draft);
    }

    if (req.method === "DELETE") {
      deleteDraft(db, draftId);
      removeFromSyncQueue(db, draftId);
      await saveDb(db);
      return sendJson(res, 200, { deleted: draftId });
    }
  }

  if (pathname === "/api/sync/queue" && req.method === "GET") {
    if (!viewer) return sendJson(res, 401, { error: "unauthorized" });
    const items = getPendingSyncItems(db, viewerId);
    return sendJson(res, 200, items);
  }

  if (pathname === "/api/sync/queue" && req.method === "POST") {
    if (!viewer) return sendJson(res, 401, { error: "unauthorized" });
    const input = await parseBody(req);
    const { draftIds } = input;

    if (!Array.isArray(draftIds) || draftIds.length === 0) {
      return sendJson(res, 400, { error: "draft_ids_required" });
    }

    const results = [];
    for (const draftId of draftIds) {
      const draft = db.offlineDrafts.find(d => d.id === draftId);
      if (draft && draft.createdBy === viewerId) {
        const existing = db.syncQueue.find(q => q.draftId === draftId);
        if (!existing) {
          const queueItem = addToSyncQueue(db, draft, viewerId);
          results.push({ draftId, queueId: queueItem.id, status: "queued" });
        } else {
          results.push({ draftId, queueId: existing.id, status: "already_queued" });
        }
      } else {
        results.push({ draftId, status: "not_found_or_forbidden" });
      }
    }

    await saveDb(db);
    return sendJson(res, 200, { results });
  }

  if (pathname === "/api/sync/detect-conflicts" && req.method === "POST") {
    if (!viewer) return sendJson(res, 401, { error: "unauthorized" });
    const input = await parseBody(req);
    const { draftIds } = input;

    if (!Array.isArray(draftIds)) {
      return sendJson(res, 400, { error: "draft_ids_required" });
    }

    const conflicts = [];
    for (const draftId of draftIds) {
      const draft = db.offlineDrafts.find(d => d.id === draftId);
      if (!draft || draft.createdBy !== viewerId) continue;

      if (draft.type === "project") {
        const serverProject = db.projects.find(p => p.id === draft.entityId);
        const conflict = detectProjectConflict(draft, serverProject);
        if (conflict) conflicts.push(conflict);
      } else if (draft.type === "timeline") {
        const project = db.projects.find(p => p.id === draft.projectId);
        const conflict = detectTimelineConflict(draft, project?.timelineRecords);
        if (conflict) conflicts.push(conflict);
      } else if (draft.type === "photos") {
        const project = db.projects.find(p => p.id === draft.projectId);
        const conflict = detectPhotosConflict(draft, project);
        if (conflict) conflicts.push(conflict);
      }
    }

    return sendJson(res, 200, { conflicts });
  }

  if (pathname === "/api/sync/execute" && req.method === "POST") {
    if (!viewer) return sendJson(res, 401, { error: "unauthorized" });
    const input = await parseBody(req);
    const { queueItemId, resolution, resolutionFields } = input;

    const queueItem = db.syncQueue.find(q => q.id === queueItemId);
    if (!queueItem) return sendJson(res, 404, { error: "queue_item_not_found" });
    if (queueItem.createdBy !== viewerId && viewer?.role !== "admin") {
      return sendJson(res, 403, { error: "forbidden" });
    }

    const draft = db.offlineDrafts.find(d => d.id === queueItem.draftId);
    if (!draft) {
      removeFromSyncQueue(db, queueItemId);
      await saveDb(db);
      return sendJson(res, 404, { error: "draft_not_found" });
    }

    let conflict = null;
    if (queueItem.type === "project") {
      const serverProject = db.projects.find(p => p.id === queueItem.entityId);
      conflict = detectProjectConflict(draft, serverProject);
    } else if (queueItem.type === "timeline") {
      const project = db.projects.find(p => p.id === queueItem.projectId);
      conflict = detectTimelineConflict(draft, project?.timelineRecords);
    } else if (queueItem.type === "photos") {
      const project = db.projects.find(p => p.id === queueItem.projectId);
      conflict = detectPhotosConflict(draft, project);
    }

    if (conflict && !resolution) {
      return sendJson(res, 409, {
        error: "conflict_detected",
        message: "检测到同步冲突，请选择解决方式",
        conflict
      });
    }

    let resultData;
    if (queueItem.type === "project") {
      resultData = await syncProject(db, queueItem, draft, conflict, resolution, resolutionFields, viewer);
    } else if (queueItem.type === "timeline") {
      resultData = await syncTimeline(db, queueItem, draft, conflict, resolution, resolutionFields, viewer);
    } else if (queueItem.type === "photos") {
      resultData = await syncPhotos(db, queueItem, draft, conflict, resolution, resolutionFields, viewer);
    }

    if (resultData.success) {
      removeFromSyncQueue(db, queueItemId);
      deleteDraft(db, draft.id);
      draft.status = "synced";
      draft.syncAttempts += 1;
      draft.lastSyncError = null;
    } else {
      draft.status = "failed";
      draft.syncAttempts += 1;
      draft.lastSyncError = resultData.error;
      saveDraft(db, draft);
    }

    await saveDb(db);

    if (resultData.success) {
      return sendJson(res, 200, {
        success: true,
        type: queueItem.type,
        entity: resultData.entity,
        restoredMovements: resultData.restoredMovements || []
      });
    } else {
      return sendJson(res, 500, {
        success: false,
        error: resultData.error
      });
    }
  }

  if (pathname === "/api/sync/status" && req.method === "GET") {
    if (!viewer) return sendJson(res, 401, { error: "unauthorized" });
    const drafts = getDraftsByUser(db, viewerId);
    const queue = getPendingSyncItems(db, viewerId);
    const stats = {
      totalDrafts: drafts.length,
      pendingDrafts: drafts.filter(d => d.status === "pending").length,
      failedDrafts: drafts.filter(d => d.status === "failed").length,
      queuedItems: queue.length
    };
    return sendJson(res, 200, { stats, drafts, queue });
  }

  if (pathname === "/api/sync/simulate-failure" && req.method === "POST") {
    if (!viewer || viewer.role !== "admin") {
      return sendJson(res, 403, { error: "forbidden" });
    }
    const input = await parseBody(req);
    const { projectId, field, value } = input;

    const project = db.projects.find(p => p.id === projectId);
    if (!project) return sendJson(res, 404, { error: "project_not_found" });

    const beforeState = deepClone(project);
    if (field && value !== undefined) {
      project[field] = value;
    }
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
      note: "[测试] 模拟他人修改项目以制造冲突"
    });

    await saveDb(db);
    return sendJson(res, 200, { project, modified: { field, value } });
  }

  return false;
}

async function syncProject(db, queueItem, draft, conflict, resolution, resolutionFields, viewer) {
  try {
    let projectData = draft.data;

    if (conflict) {
      const res = resolution === "custom" ? { fields: resolutionFields } : resolution;
      projectData = resolveConflict(conflict, res, draft, db);
    }

    const sanitized = sanitizeProjectInput(projectData);
    let project;
    const beforeState = {};

    if (queueItem.operation === "create") {
      project = {
        id: `R-${Date.now()}`,
        status: "进行中",
        updatedAt: new Date().toISOString().slice(0, 10),
        version: 1,
        reviewRecords: [],
        timelineRecords: [],
        photoArchive: { before: [], during: [], after: [] },
        templateSnapshot: null,
        ...sanitized
      };
      db.projects.unshift(project);

      recordAudit(db, {
        projectId: project.id,
        actionType: ACTION_TYPES.PROJECT_CREATE,
        operator: viewer.name,
        operatorId: viewer.id,
        source: SOURCES.SYNC,
        beforeState: null,
        afterState: deepClone(project),
        note: "从离线草稿同步创建"
      });
    } else {
      project = db.projects.find(p => p.id === queueItem.entityId);
      if (!project) return { success: false, error: "project_not_found" };

      Object.assign(beforeState, project);

      const oldStatus = project.status;
      incrementVersion(project);
      Object.assign(project, sanitized, {
        updatedAt: new Date().toISOString().slice(0, 10)
      });

      const statusChanged = sanitized.status && sanitized.status !== oldStatus;
      if (statusChanged && project.timelineRecords) {
        project.timelineRecords.push(createSystemRecord({
          operator: viewer.name,
          operatorId: viewer.id,
          oldStatus,
          newStatus: sanitized.status
        }));
      }

      const actionType = statusChanged ? ACTION_TYPES.STATUS_CHANGE : ACTION_TYPES.PROJECT_UPDATE;
      recordAudit(db, {
        projectId: project.id,
        actionType,
        operator: viewer.name,
        operatorId: viewer.id,
        source: SOURCES.SYNC,
        beforeState: deepClone(beforeState),
        afterState: deepClone(project),
        note: conflict ? "同步（已解决冲突）" : "从离线草稿同步更新"
      });
    }

    return { success: true, entity: project };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function syncTimeline(db, queueItem, draft, conflict, resolution, resolutionFields, viewer) {
  try {
    const project = db.projects.find(p => p.id === queueItem.projectId);
    if (!project) return { success: false, error: "project_not_found" };

    if (!project.timelineRecords) project.timelineRecords = [];

    if (queueItem.operation === "delete") {
      const idx = project.timelineRecords.findIndex(r => r.id === queueItem.entityId);
      if (idx === -1) {
        return { success: false, error: "record_not_found" };
      }

      const beforeState = deepClone(project);
      const [removed] = project.timelineRecords.splice(idx, 1);
      const restoredMovements = restoreMaterials(removed, db);

      incrementVersion(project);
      project.updatedAt = new Date().toISOString().slice(0, 10);

      recordAudit(db, {
        projectId: project.id,
        actionType: ACTION_TYPES.PROJECT_UPDATE,
        operator: viewer.name,
        operatorId: viewer.id,
        source: SOURCES.SYNC,
        beforeState,
        afterState: deepClone(project),
        note: conflict ? "同步删除过程记录（已解决冲突）" : "同步删除过程记录，材料库存已恢复"
      });

      return { success: true, entity: removed, restoredMovements };
    }

    let timelineData = draft.data;
    if (conflict) {
      const res = resolution === "custom" ? { fields: resolutionFields } : resolution;
      timelineData = resolveConflict(conflict, res, draft, db);
    }

    const sanitized = sanitizeTimelineInput(timelineData);

    if (queueItem.operation === "create" || queueItem.operation === "update") {
      const materialErrors = validateMaterialUsages(sanitized.materialUsages, db);
      if (materialErrors.length > 0) {
        return { success: false, error: "材料校验失败：" + materialErrors.map(e => e.message).join("；") };
      }

      const shortages = checkStockSufficiency(sanitized.materialUsages, db);
      if (shortages.length > 0) {
        const shortageMsgs = shortages.map(s =>
          `${s.materialName}：需要 ${s.required}${s.unit}，库存仅 ${s.available}${s.unit}，缺口 ${s.shortage}${s.unit}`
        ).join("；");
        return { success: false, error: "材料库存不足：" + shortageMsgs };
      }
    }

    const record = {
      id: queueItem.entityId || `T-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "manual",
      version: 1,
      createdAt: new Date().toISOString(),
      operatorId: viewer.id,
      ...sanitized
    };

    if (sanitized.materialUsages && sanitized.materialUsages.length > 0) {
      const materialUsagesText = formatMaterialUsagesText(sanitized.materialUsages, db);
      const materialsField = (sanitized.materials || "").trim();
      record.materials = materialsField && !materialUsagesText
        ? materialsField
        : materialUsagesText
          ? (materialsField ? materialsField + "；" + materialUsagesText : materialUsagesText)
          : "";
    }

    const beforeState = deepClone(project);
    let restoredMovements = [];

    if (queueItem.operation === "update") {
      const idx = project.timelineRecords.findIndex(r => r.id === queueItem.entityId);
      if (idx !== -1) {
        const oldRecord = project.timelineRecords[idx];
        restoredMovements = restoreMaterials(oldRecord, db);

        record.version = (oldRecord.version || 1) + 1;
        record.createdAt = oldRecord.createdAt;
        project.timelineRecords[idx] = record;
      } else {
        project.timelineRecords.push(record);
      }
    } else {
      project.timelineRecords.push(record);
    }

    if (sanitized.materialUsages && sanitized.materialUsages.length > 0) {
      consumeMaterials(
        sanitized.materialUsages,
        db,
        project.id,
        record.id,
        sanitized.operator || viewer.name,
        viewer.id
      );
    }

    incrementVersion(project);
    project.updatedAt = new Date().toISOString().slice(0, 10);

    const note = conflict
      ? (queueItem.operation === "update" ? "同步更新过程记录（已解决冲突）" : "同步过程记录（已解决冲突）")
      : (queueItem.operation === "update" ? "同步更新过程记录" : "同步过程记录");

    recordAudit(db, {
      projectId: project.id,
      actionType: ACTION_TYPES.PROJECT_UPDATE,
      operator: viewer.name,
      operatorId: viewer.id,
      source: SOURCES.SYNC,
      beforeState,
      afterState: deepClone(project),
      note
    });

    return { success: true, entity: record, restoredMovements };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function syncPhotos(db, queueItem, draft, conflict, resolution, resolutionFields, viewer) {
  try {
    const project = db.projects.find(p => p.id === queueItem.projectId);
    if (!project) return { success: false, error: "project_not_found" };

    if (!project.photoArchive) {
      project.photoArchive = { before: [], during: [], after: [] };
    }

    const stage = draft.data.stage;
    const operation = draft.operation;
    const beforeState = deepClone(project);

    let serverPhotos = [...(project.photoArchive[stage] || [])];

    if (conflict) {
      const res = resolution === "custom" ? { fields: resolutionFields } : resolution;
      const resolved = resolvePhotosConflict(conflict, res, draft, serverPhotos);
      serverPhotos = resolved.photos;
    } else {
      if (operation === "add") {
        const url = draft.data.url;
        if (!serverPhotos.includes(url)) {
          serverPhotos.push(url);
        }
      } else if (operation === "delete") {
        const index = draft.data.index;
        if (index >= 0 && index < serverPhotos.length) {
          serverPhotos.splice(index, 1);
        }
      }
    }

    project.photoArchive[stage] = serverPhotos;
    incrementVersion(project);
    project.updatedAt = new Date().toISOString().slice(0, 10);

    const note = conflict
      ? `同步${operation === "add" ? "添加" : "删除"}照片（已解决冲突）`
      : `同步${operation === "add" ? "添加" : "删除"}照片`;

    recordAudit(db, {
      projectId: project.id,
      actionType: ACTION_TYPES.PROJECT_UPDATE,
      operator: viewer.name,
      operatorId: viewer.id,
      source: SOURCES.SYNC,
      beforeState,
      afterState: deepClone(project),
      note
    });

    return { success: true, entity: { stage, photoArchive: project.photoArchive } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
