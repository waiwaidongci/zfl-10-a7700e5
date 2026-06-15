import { getAuditLogById, recordAudit, ACTION_TYPES, SOURCES } from "./audit.js";
import { TRACKED_FIELDS, deepClone, computeDiff, isMeaningfulChange } from "./diff.js";

const ROLLBACK_VALID_STATUSES = ["进行中", "待复核", "已完成"];

function canRollback(user) {
  return user && user.role === "admin";
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

function computeRollbackPreview(project, targetLog) {
  if (!targetLog || !targetLog.afterState) {
    return null;
  }

  const targetState = targetLog.afterState;
  const changes = computeDiff(project, targetState);

  return {
    targetLogId: targetLog.id,
    targetTimestamp: targetLog.timestamp,
    targetAction: targetLog.actionLabel,
    targetOperator: targetLog.operator,
    willChange: changes,
    hasChanges: isMeaningfulChange(changes)
  };
}

function applyRollback(db, projectId, targetLogId, operator, operatorId) {
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

  const rollbackLog = recordAudit(db, {
    projectId,
    actionType: ACTION_TYPES.ROLLBACK,
    operator,
    operatorId,
    source: SOURCES.ROLLBACK,
    beforeState,
    afterState,
    note: `回滚到操作：${targetLog.actionLabel}（${targetLog.id}），由 ${targetLog.operator} 于 ${targetLog.timestamp} 执行`,
    relatedId: targetLog.id
  });

  return {
    success: true,
    project,
    rollbackLog,
    targetLog
  };
}

export {
  canRollback,
  validateRollbackTarget,
  computeRollbackPreview,
  applyRollback,
  ROLLBACK_VALID_STATUSES
};
