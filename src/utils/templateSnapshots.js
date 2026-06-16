export function bumpVersion(template) {
  return (template.version || 0) + 1;
}

export function createSnapshot(template) {
  return {
    templateId: template.id,
    templateName: template.name,
    templateCategory: template.category,
    templateVersion: template.version,
    steps: template.steps,
    materials: template.materials,
    estimatedDays: template.estimatedDays,
    reviewRequired: template.reviewRequired,
    reviewNotes: template.reviewNotes || "",
    appliedAt: new Date().toISOString().slice(0, 10)
  };
}

export function createTemplateVersionRecord(template, { operator = "系统", operatorId = "" } = {}) {
  return {
    id: `TV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId: template.id,
    version: template.version,
    name: template.name,
    category: template.category,
    steps: template.steps,
    materials: template.materials,
    estimatedDays: template.estimatedDays,
    reviewRequired: template.reviewRequired,
    reviewNotes: template.reviewNotes || "",
    operator,
    operatorId,
    createdAt: new Date().toISOString().slice(0, 10)
  };
}

export function applyTemplateToProject(template, { baseDate = new Date() } = {}) {
  const due = new Date(baseDate);
  due.setDate(due.getDate() + template.estimatedDays);
  return {
    steps: template.steps,
    materials: template.materials,
    dueDate: due.toISOString().slice(0, 10),
    reviewRequired: template.reviewRequired
  };
}

export function isSnapshotValid(snapshot) {
  return snapshot
    && typeof snapshot === "object"
    && snapshot.templateId
    && typeof snapshot.templateVersion === "number"
    && snapshot.steps
    && snapshot.materials
    && typeof snapshot.estimatedDays === "number";
}

export function compareTemplateWithSnapshot(template, snapshot) {
  if (!template || !snapshot) return null;
  if (snapshot.templateId !== template.id) return null;

  const isNewer = template.version > (snapshot.templateVersion || 0);

  const fieldDifferences = {
    steps: {
      changed: template.steps !== snapshot.steps,
      oldValue: snapshot.steps,
      newValue: template.steps
    },
    materials: {
      changed: template.materials !== snapshot.materials,
      oldValue: snapshot.materials,
      newValue: template.materials
    },
    estimatedDays: {
      changed: (template.estimatedDays || 0) !== (snapshot.estimatedDays || 0),
      oldValue: snapshot.estimatedDays,
      newValue: template.estimatedDays
    },
    reviewRequired: {
      changed: (template.reviewRequired !== false) !== (snapshot.reviewRequired !== false),
      oldValue: snapshot.reviewRequired,
      newValue: template.reviewRequired
    },
    reviewNotes: {
      changed: (template.reviewNotes || "") !== (snapshot.reviewNotes || ""),
      oldValue: snapshot.reviewNotes,
      newValue: template.reviewNotes
    }
  };

  const changedFields = Object.keys(fieldDifferences).filter(key => fieldDifferences[key].changed);
  const syncedFieldVersions = snapshot.syncedFieldVersions || {};
  const partiallySyncedFields = Object.keys(syncedFieldVersions);
  const isPartiallySynced = partiallySyncedFields.length > 0 && changedFields.length > 0;
  const isFullyUpToDate = changedFields.length === 0;

  return {
    isNewer,
    isPartiallySynced,
    isFullyUpToDate,
    templateId: template.id,
    templateName: template.name,
    templateCategory: template.category,
    snapshotVersion: snapshot.templateVersion || 0,
    currentVersion: template.version,
    appliedAt: snapshot.appliedAt,
    fieldDifferences,
    changedFields,
    partiallySyncedFields,
    hasChanges: changedFields.length > 0
  };
}

export function archiveSnapshot(snapshot, { syncedFrom = null, syncedAt = new Date().toISOString().slice(0, 10), operator = "", operatorId = "" } = {}) {
  return {
    ...snapshot,
    _archived: true,
    _syncedFrom: syncedFrom,
    _syncedAt: syncedAt,
    _syncedBy: operator,
    _syncedById: operatorId
  };
}
