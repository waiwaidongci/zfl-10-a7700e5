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
