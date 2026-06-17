import { computeDiff, extractTrackedFields, deepClone, formatChangeSummary, isMeaningfulChange } from "./diff.js";

const ACTION_TYPES = {
  PROJECT_CREATE: "project_create",
  PROJECT_UPDATE: "project_update",
  STATUS_CHANGE: "status_change",
  REVIEW_PASS: "review_pass",
  REVIEW_REJECT: "review_reject",
  ROLLBACK: "rollback",
  TEMPLATE_SYNC: "template_sync"
};

const ACTION_LABELS = {
  project_create: "创建项目",
  project_update: "修改项目",
  status_change: "状态变更",
  review_pass: "复核通过",
  review_reject: "复核退回",
  rollback: "回滚操作",
  template_sync: "同步模板更新"
};

const SOURCES = {
  API: "api",
  SYSTEM: "system",
  REVIEW: "review",
  ROLLBACK: "rollback",
  SYNC: "sync"
};

function generateAuditId() {
  return `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureAuditCollection(db) {
  if (!db.auditLogs || !Array.isArray(db.auditLogs)) {
    db.auditLogs = [];
    return true;
  }
  return false;
}

function createAuditLog({
  projectId,
  actionType,
  operator,
  operatorId,
  source,
  beforeState,
  afterState,
  note = "",
  relatedId = null
}) {
  const changes = computeDiff(beforeState, afterState, true);
  const summary = isMeaningfulChange(changes) ? formatChangeSummary(changes) : "项目创建";

  return {
    id: generateAuditId(),
    projectId,
    actionType,
    actionLabel: ACTION_LABELS[actionType] || actionType,
    operator: operator || "未知用户",
    operatorId: operatorId || "",
    source: source || SOURCES.API,
    timestamp: new Date().toISOString(),
    beforeState: beforeState ? extractTrackedFields(beforeState) : null,
    afterState: afterState ? extractTrackedFields(afterState) : null,
    changes,
    summary,
    note: note || "",
    relatedId
  };
}

function recordAudit(db, auditData) {
  ensureAuditCollection(db);
  const log = createAuditLog(auditData);
  db.auditLogs.unshift(log);
  return log;
}

function getProjectAuditLogs(db, projectId, options = {}) {
  ensureAuditCollection(db);
  let logs = db.auditLogs.filter(log => log.projectId === projectId);

  if (options.actionType) {
    logs = logs.filter(log => log.actionType === options.actionType);
  }

  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (options.limit && options.limit > 0) {
    logs = logs.slice(0, options.limit);
  }

  return logs;
}

function getAuditLogById(db, logId) {
  ensureAuditCollection(db);
  return db.auditLogs.find(log => log.id === logId) || null;
}

function getLatestAuditLog(db, projectId) {
  const logs = getProjectAuditLogs(db, projectId, { limit: 1 });
  return logs.length > 0 ? logs[0] : null;
}

export {
  ACTION_TYPES,
  ACTION_LABELS,
  SOURCES,
  createAuditLog,
  recordAudit,
  getProjectAuditLogs,
  getAuditLogById,
  getLatestAuditLog,
  ensureAuditCollection
};
