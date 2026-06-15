import { deepClone } from "./diff.js";

const CONFLICT_FIELDS = ["title", "era", "damage", "steps", "materials", "owner", "dueDate", "status", "photos"];
const TIMELINE_CONFLICT_FIELDS = ["operator", "date", "steps", "materials", "notes", "photoUrl"];

export function generateDraftId() {
  return `D-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateSyncQueueId() {
  return `SQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createProjectDraft(projectData, userId) {
  return {
    id: generateDraftId(),
    type: "project",
    entityType: "project",
    operation: projectData.id ? "update" : "create",
    entityId: projectData.id || null,
    data: deepClone(projectData),
    baseVersion: projectData.version || 1,
    createdBy: userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "pending",
    syncAttempts: 0,
    lastSyncError: null
  };
}

export function createTimelineDraft(projectId, timelineData, userId) {
  return {
    id: generateDraftId(),
    type: "timeline",
    entityType: "timeline",
    operation: timelineData.id ? "update" : "create",
    entityId: timelineData.id || null,
    projectId,
    data: deepClone(timelineData),
    baseVersion: timelineData.version || 1,
    createdBy: userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "pending",
    syncAttempts: 0,
    lastSyncError: null
  };
}

export function detectProjectConflict(localDraft, serverProject) {
  if (!serverProject) return null;
  if (localDraft.baseVersion >= serverProject.version) return null;

  const conflicts = [];
  const localData = localDraft.data;

  for (const field of CONFLICT_FIELDS) {
    if (localData[field] !== undefined && localData[field] !== serverProject[field]) {
      conflicts.push({
        field,
        localValue: localData[field],
        serverValue: serverProject[field]
      });
    }
  }

  if (conflicts.length === 0) return null;

  return {
    type: "project",
    entityId: localDraft.entityId || localDraft.id,
    draftId: localDraft.id,
    baseVersion: localDraft.baseVersion,
    serverVersion: serverProject.version,
    conflicts,
    localSnapshot: deepClone(localData),
    serverSnapshot: deepClone(serverProject)
  };
}

export function detectTimelineConflict(localDraft, serverRecords) {
  if (!serverRecords || !Array.isArray(serverRecords)) return null;

  const serverRecord = serverRecords.find(r => r.id === localDraft.entityId);
  if (!serverRecord) return null;
  if (localDraft.baseVersion >= serverRecord.version) return null;

  const conflicts = [];
  const localData = localDraft.data;

  for (const field of TIMELINE_CONFLICT_FIELDS) {
    if (localData[field] !== undefined && localData[field] !== serverRecord[field]) {
      conflicts.push({
        field,
        localValue: localData[field],
        serverValue: serverRecord[field]
      });
    }
  }

  if (conflicts.length === 0) return null;

  return {
    type: "timeline",
    entityId: localDraft.entityId,
    draftId: localDraft.id,
    projectId: localDraft.projectId,
    baseVersion: localDraft.baseVersion,
    serverVersion: serverRecord.version,
    conflicts,
    localSnapshot: deepClone(localData),
    serverSnapshot: deepClone(serverRecord)
  };
}

export function resolveConflict(conflict, resolution, draft, db) {
  const resolvedData = deepClone(draft.data);

  for (const fieldConflict of conflict.conflicts) {
    if (resolution === "local") {
      resolvedData[fieldConflict.field] = fieldConflict.localValue;
    } else if (resolution === "server") {
      resolvedData[fieldConflict.field] = fieldConflict.serverValue;
    } else if (resolution === "custom" && resolution.fields) {
      const fieldResolution = resolution.fields[fieldConflict.field];
      if (fieldResolution === "local") {
        resolvedData[fieldConflict.field] = fieldConflict.localValue;
      } else if (fieldResolution === "server") {
        resolvedData[fieldConflict.field] = fieldConflict.serverValue;
      }
    }
  }

  return resolvedData;
}

export function addToSyncQueue(db, draft, userId) {
  const queueItem = {
    id: generateSyncQueueId(),
    draftId: draft.id,
    type: draft.type,
    entityType: draft.entityType,
    operation: draft.operation,
    entityId: draft.entityId,
    projectId: draft.projectId || null,
    data: deepClone(draft.data),
    baseVersion: draft.baseVersion,
    createdBy: userId,
    createdAt: new Date().toISOString(),
    status: "pending",
    priority: Date.now()
  };

  db.syncQueue.push(queueItem);
  return queueItem;
}

export function removeFromSyncQueue(db, queueItemId) {
  const idx = db.syncQueue.findIndex(item => item.id === queueItemId);
  if (idx !== -1) {
    return db.syncQueue.splice(idx, 1)[0];
  }
  return null;
}

export function getPendingSyncItems(db, userId = null) {
  let items = db.syncQueue.filter(item => item.status === "pending");
  if (userId) {
    items = items.filter(item => item.createdBy === userId);
  }
  return items.sort((a, b) => a.priority - b.priority);
}

export function getDraftsByUser(db, userId) {
  return db.offlineDrafts
    .filter(d => d.createdBy === userId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function saveDraft(db, draft) {
  const existing = db.offlineDrafts.find(d => d.id === draft.id);
  draft.updatedAt = new Date().toISOString();

  if (existing) {
    Object.assign(existing, draft);
    return existing;
  } else {
    db.offlineDrafts.push(draft);
    return draft;
  }
}

export function deleteDraft(db, draftId) {
  const idx = db.offlineDrafts.findIndex(d => d.id === draftId);
  if (idx !== -1) {
    return db.offlineDrafts.splice(idx, 1)[0];
  }
  return null;
}

export function incrementVersion(entity) {
  entity.version = (entity.version || 1) + 1;
  return entity;
}
