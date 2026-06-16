import { getAuditLogById, recordAudit, ACTION_TYPES, SOURCES } from "./audit.js";
import { TRACKED_FIELDS, deepClone, computeDiff, isMeaningfulChange } from "./diff.js";

const ROLLBACK_VALID_STATUSES = ["进行中", "待复核", "已完成"];

function canRollback(user) {
  return user && user.role === "admin";
}

function canViewAudit(user, project) {
  if (!user || !project) return false;
  if (user.role === "admin") return true;
  return project.owner === user.name;
}

function validateRollbackTarget(db, projectId, targetLogId) {
  const errors = [];

  const project = db.projects.find(p => p.id === projectId);
  if (!project) {
    errors.push("项目不存在");
    return { valid: false, errors, project: null, targetLog: null };
  }

  const targetLog = getAuditLogById(db, targetLogId);
  if (!targetLog) {
    errors.push("目标审计记录不存在");
    return { valid: false, errors, project, targetLog: null };
  }

  if (targetLog.projectId !== projectId) {
    errors.push("审计记录不属于该项目");
    return { valid: false, errors, project, targetLog };
  }

  if (!targetLog.afterState) {
    errors.push("目标审计记录无可回滚的状态快照");
    return { valid: false, errors, project, targetLog };
  }

  if (targetLog.actionType === ACTION_TYPES.ROLLBACK) {
    errors.push("不能回滚到一次回滚操作");
    return { valid: false, errors, project, targetLog };
  }

  return { valid: true, errors: [], project, targetLog };
}

function summarizeReviewRecords(records) {
  if (!records || !Array.isArray(records) || records.length === 0) {
    return { count: 0, summary: "无复核记录", items: [] };
  }
  return {
    count: records.length,
    summary: `共 ${records.length} 条复核记录`,
    items: records.slice().reverse().map((r, idx) => ({
      index: records.length - idx,
      reviewer: r.reviewer || "未知复核人",
      result: r.result || "",
      resultLabel: r.result === "pass" ? "通过" : r.result === "reject" ? "退回" : r.result || "",
      date: r.date || "",
      opinion: r.opinion || ""
    }))
  };
}

function summarizeTimelineRecords(records) {
  if (!records || !Array.isArray(records) || records.length === 0) {
    return { count: 0, summary: "无时间线记录", items: [] };
  }
  const sorted = records.slice().sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
  return {
    count: sorted.length,
    summary: `共 ${sorted.length} 条时间线记录`,
    items: sorted.slice(0, 5).map(r => ({
      type: r.type || "manual",
      typeLabel: r.type === "system" ? "系统记录" : "人工记录",
      operator: r.operator || "",
      date: r.date || r.createdAt || "",
      steps: r.steps || "",
      systemMessage: r.systemMessage || ""
    })),
    hasMore: sorted.length > 5
  };
}

function summarizePhotoArchive(archive) {
  if (!archive || typeof archive !== "object") {
    return { before: 0, during: 0, after: 0, total: 0, summary: "无照片归档" };
  }
  const before = Array.isArray(archive.before) ? archive.before.length : 0;
  const during = Array.isArray(archive.during) ? archive.during.length : 0;
  const after = Array.isArray(archive.after) ? archive.after.length : 0;
  const total = before + during + after;
  return {
    before,
    during,
    after,
    total,
    summary: total > 0
      ? `共 ${total} 张（修复前 ${before} 张、修复中 ${during} 张、修复后 ${after} 张）`
      : "无照片归档"
  };
}

function summarizeTemplateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return { exists: false, summary: "无关联模板快照" };
  }
  return {
    exists: true,
    templateId: snapshot.templateId || "",
    templateName: snapshot.templateName || "",
    templateCategory: snapshot.templateCategory || "",
    templateVersion: snapshot.templateVersion || 0,
    appliedAt: snapshot.appliedAt || "",
    estimatedDays: snapshot.estimatedDays || 0,
    reviewRequired: !!snapshot.reviewRequired,
    summary: `${snapshot.templateName || "未知模板"} v${snapshot.templateVersion || 0}`
  };
}

function computeFieldLevelChanges(project, targetState) {
  const allChanges = computeDiff(project, targetState);
  const scalarFields = ["title", "era", "damage", "steps", "materials", "owner", "dueDate", "status", "photos"];
  return allChanges.filter(c => scalarFields.includes(c.field));
}

function computeRollbackPreview(project, targetLog) {
  if (!targetLog || !targetLog.afterState) {
    return null;
  }

  const targetState = targetLog.afterState;
  const fieldChanges = computeFieldLevelChanges(project, targetState);

  const currentReviewSummary = summarizeReviewRecords(project.reviewRecords);
  const targetReviewSummary = summarizeReviewRecords(targetState.reviewRecords);
  const reviewRecordsWillChange = JSON.stringify(currentReviewSummary.items) !== JSON.stringify(targetReviewSummary.items)
    || currentReviewSummary.count !== targetReviewSummary.count;

  const currentTimelineSummary = summarizeTimelineRecords(project.timelineRecords);
  const targetTimelineSummary = summarizeTimelineRecords(targetState.timelineRecords);
  const timelineWillChange = currentTimelineSummary.count !== targetTimelineSummary.count;

  const currentPhotoSummary = summarizePhotoArchive(project.photoArchive);
  const targetPhotoSummary = summarizePhotoArchive(targetState.photoArchive);
  const photosWillChange = currentPhotoSummary.total !== targetPhotoSummary.total
    || currentPhotoSummary.before !== targetPhotoSummary.before
    || currentPhotoSummary.during !== targetPhotoSummary.during
    || currentPhotoSummary.after !== targetPhotoSummary.after;

  const currentTemplateSummary = summarizeTemplateSnapshot(project.templateSnapshot);
  const targetTemplateSummary = summarizeTemplateSnapshot(targetState.templateSnapshot);
  const templateWillChange = currentTemplateSummary.summary !== targetTemplateSummary.summary;

  const hasChanges = isMeaningfulChange(fieldChanges)
    || reviewRecordsWillChange
    || timelineWillChange
    || photosWillChange
    || templateWillChange;

  return {
    targetLogId: targetLog.id,
    targetTimestamp: targetLog.timestamp,
    targetAction: targetLog.actionLabel,
    targetOperator: targetLog.operator,
    fieldChanges,
    hasFieldChanges: isMeaningfulChange(fieldChanges),
    reviewRecords: {
      willChange: reviewRecordsWillChange,
      current: currentReviewSummary,
      target: targetReviewSummary
    },
    timelineRecords: {
      willChange: timelineWillChange,
      current: currentTimelineSummary,
      target: targetTimelineSummary
    },
    photoArchive: {
      willChange: photosWillChange,
      current: currentPhotoSummary,
      target: targetPhotoSummary
    },
    templateSnapshot: {
      willChange: templateWillChange,
      current: currentTemplateSummary,
      target: targetTemplateSummary
    },
    hasChanges
  };
}

function applyRollback(db, projectId, targetLogId, operator, operatorId, reason) {
  const validation = validateRollbackTarget(db, projectId, targetLogId);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors
    };
  }

  const { project, targetLog } = validation;
  const targetState = targetLog.afterState;

  const beforeState = deepClone(project);

  for (const field of TRACKED_FIELDS) {
    if (field in targetState) {
      if (field === "status") {
        if (ROLLBACK_VALID_STATUSES.includes(targetState[field])) {
          project[field] = targetState[field];
        }
      } else {
        project[field] = targetState[field];
      }
    }
  }

  project.updatedAt = new Date().toISOString().slice(0, 10);

  const afterState = deepClone(project);

  const noteBase = `回滚到操作：${targetLog.actionLabel}（${targetLog.id}），由 ${targetLog.operator} 于 ${targetLog.timestamp} 执行`;
  const fullNote = reason ? `${reason} —— ${noteBase}` : noteBase;

  const rollbackLog = recordAudit(db, {
    projectId,
    actionType: ACTION_TYPES.ROLLBACK,
    operator,
    operatorId,
    source: SOURCES.ROLLBACK,
    beforeState,
    afterState,
    note: fullNote,
    relatedId: targetLog.id
  });

  rollbackLog.rollbackMeta = {
    reason: reason || "",
    sourceLogId: targetLog.id,
    sourceLogAction: targetLog.actionLabel,
    sourceLogOperator: targetLog.operator,
    sourceLogTimestamp: targetLog.timestamp,
    targetLogId: rollbackLog.id
  };

  return {
    success: true,
    project,
    rollbackLog,
    targetLog
  };
}

export {
  canRollback,
  canViewAudit,
  validateRollbackTarget,
  computeRollbackPreview,
  applyRollback,
  ROLLBACK_VALID_STATUSES
};
