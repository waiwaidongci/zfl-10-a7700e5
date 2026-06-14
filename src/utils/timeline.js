export function createTimelineRecord({ type, operator, operatorId, date, steps, materials, notes, photoUrl, systemMessage }) {
  return {
    id: `T-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: type || "manual",
    operator: operator || "",
    operatorId: operatorId || "",
    date: date || new Date().toISOString().slice(0, 10),
    steps: steps || "",
    materials: materials || "",
    notes: notes || "",
    photoUrl: photoUrl || "",
    systemMessage: systemMessage || "",
    createdAt: new Date().toISOString()
  };
}

export function createSystemRecord({ operator, operatorId, oldStatus, newStatus }) {
  return createTimelineRecord({
    type: "system",
    operator: operator || "系统",
    operatorId: operatorId || "",
    systemMessage: `状态变更：${oldStatus || "无"} → ${newStatus}`,
    steps: "状态自动流转",
    materials: "",
    notes: ""
  });
}

export function validateTimelineRecord(input) {
  const errors = [];
  if (!input.operator || input.operator.trim() === "") {
    errors.push({ field: "operator", message: "操作人不能为空" });
  }
  if (!input.date || input.date.trim() === "") {
    errors.push({ field: "date", message: "日期不能为空" });
  }
  if (!input.steps || input.steps.trim() === "") {
    errors.push({ field: "steps", message: "处理步骤不能为空" });
  }
  if (input.photoUrl && input.photoUrl.trim() !== "") {
    try {
      new URL(input.photoUrl);
    } catch {
      errors.push({ field: "photoUrl", message: "照片链接格式不正确" });
    }
  }
  return errors;
}

export function getLatestRecord(records) {
  if (!records || records.length === 0) return null;
  return [...records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

export function sortRecords(records) {
  if (!records || records.length === 0) return [];
  return [...records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
