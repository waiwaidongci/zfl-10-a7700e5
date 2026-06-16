const TRACKED_FIELDS = [
  "title",
  "era",
  "damage",
  "steps",
  "materials",
  "owner",
  "dueDate",
  "status",
  "photos",
  "reviewRecords",
  "timelineRecords",
  "photoArchive",
  "templateSnapshot"
];

const FIELD_LABELS = {
  title: "藏品名称",
  era: "年代",
  damage: "破损情况",
  steps: "修复步骤",
  materials: "使用材料",
  owner: "负责人",
  dueDate: "预计完成日期",
  status: "状态",
  photos: "封面照片",
  reviewRecords: "复核记录",
  timelineRecords: "时间线记录",
  photoArchive: "照片归档",
  templateSnapshot: "模板快照"
};

function deepClone(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const cloned = {};
  for (const key of Object.keys(obj)) {
    cloned[key] = deepClone(obj[key]);
  }
  return cloned;
}

function extractTrackedFields(obj) {
  const result = {};
  for (const field of TRACKED_FIELDS) {
    if (obj && field in obj) {
      result[field] = obj[field];
    }
  }
  return result;
}

function computeDiff(before, after) {
  const changes = [];
  const beforeTracked = extractTrackedFields(before || {});
  const afterTracked = extractTrackedFields(after || {});
  const allFields = new Set([...Object.keys(beforeTracked), ...Object.keys(afterTracked)]);

  for (const field of allFields) {
    const oldVal = beforeTracked[field];
    const newVal = afterTracked[field];
    const oldIsUndefined = oldVal === undefined || oldVal === null;
    const newIsUndefined = newVal === undefined || newVal === null;

    if (oldIsUndefined && newIsUndefined) continue;

    if (oldIsUndefined && !newIsUndefined) {
      changes.push({
        field,
        label: FIELD_LABELS[field] || field,
        oldValue: null,
        newValue: newVal,
        type: "add"
      });
    } else if (!oldIsUndefined && newIsUndefined) {
      changes.push({
        field,
        label: FIELD_LABELS[field] || field,
        oldValue: oldVal,
        newValue: null,
        type: "remove"
      });
    } else if (oldVal !== newVal) {
      changes.push({
        field,
        label: FIELD_LABELS[field] || field,
        oldValue: oldVal,
        newValue: newVal,
        type: "modify"
      });
    }
  }

  return changes;
}

function formatChangeSummary(changes) {
  if (!changes || changes.length === 0) return "无变更";
  if (changes.length === 1) {
    const c = changes[0];
    return `${c.label}：${truncate(c.oldValue, 20)} → ${truncate(c.newValue, 20)}`;
  }
  return `${changes.length} 个字段变更：${changes.map(c => c.label).join("、")}`;
}

function truncate(str, maxLen) {
  if (str === null || str === undefined) return "(空)";
  const s = String(str);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "…";
}

function isMeaningfulChange(changes) {
  return changes && changes.length > 0;
}

export {
  TRACKED_FIELDS,
  FIELD_LABELS,
  deepClone,
  extractTrackedFields,
  computeDiff,
  formatChangeSummary,
  truncate,
  isMeaningfulChange
};
