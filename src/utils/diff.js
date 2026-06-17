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

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (!deepEqual(a[keysA[i]], b[keysB[i]])) return false;
  }

  return true;
}

const COMPLEX_FIELDS = ["reviewRecords", "timelineRecords", "photoArchive", "templateSnapshot"];

function extractTrackedFields(obj) {
  const result = {};
  for (const field of TRACKED_FIELDS) {
    if (obj && field in obj) {
      result[field] = obj[field];
    }
  }
  return result;
}

function computeDiff(before, after, includeComplex = false) {
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

    const isComplex = COMPLEX_FIELDS.includes(field);

    if (!includeComplex && isComplex) continue;

    let hasChange = false;

    if (oldIsUndefined && !newIsUndefined) {
      hasChange = true;
    } else if (!oldIsUndefined && newIsUndefined) {
      hasChange = true;
    } else if (isComplex) {
      hasChange = !deepEqual(oldVal, newVal);
    } else {
      hasChange = oldVal !== newVal;
    }

    if (hasChange) {
      let type = "modify";
      let oldValue = oldVal;
      let newValue = newVal;

      if (oldIsUndefined && !newIsUndefined) {
        type = "add";
        oldValue = null;
      } else if (!oldIsUndefined && newIsUndefined) {
        type = "remove";
        newValue = null;
      }

      changes.push({
        field,
        label: FIELD_LABELS[field] || field,
        oldValue,
        newValue,
        type
      });
    }
  }

  return changes;
}

function formatChangeSummary(changes) {
  if (!changes || changes.length === 0) return "无变更";
  if (changes.length === 1) {
    const c = changes[0];
    return `${c.label}：${formatValueForSummary(c.field, c.oldValue, 20)} → ${formatValueForSummary(c.field, c.newValue, 20)}`;
  }
  return `${changes.length} 个字段变更：${changes.map(c => c.label).join("、")}`;
}

function formatValueForSummary(field, value, maxLen) {
  if (field === "reviewRecords" || field === "timelineRecords") {
    return Array.isArray(value) ? `${value.length} 条` : "(空)";
  }

  if (field === "photoArchive") {
    if (!value || typeof value !== "object") return "(空)";
    const before = Array.isArray(value.before) ? value.before.length : 0;
    const during = Array.isArray(value.during) ? value.during.length : 0;
    const after = Array.isArray(value.after) ? value.after.length : 0;
    return `前${before}张/中${during}张/后${after}张`;
  }

  if (field === "templateSnapshot") {
    if (!value || typeof value !== "object") return "(空)";
    const name = value.templateName || "未知模板";
    const version = value.templateVersion || 0;
    return truncate(`${name} v${version}`, maxLen);
  }

  return truncate(value, maxLen);
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
  COMPLEX_FIELDS,
  deepClone,
  deepEqual,
  extractTrackedFields,
  computeDiff,
  formatChangeSummary,
  formatValueForSummary,
  truncate,
  isMeaningfulChange
};
