export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function isPositiveInteger(value) {
  const num = Number(value);
  return !isNaN(num) && num > 0 && Number.isInteger(num);
}

export function isValidDateString(value) {
  if (typeof value !== "string") return false;
  const d = new Date(value);
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isBoolean(value) {
  return typeof value === "boolean";
}

export function validateTemplate(input, { existingTemplates = [], excludeId = null } = {}) {
  const errors = [];
  if (!isNonEmptyString(input.name)) {
    errors.push("模板名称不能为空");
  } else if (input.name.trim().length > 100) {
    errors.push("模板名称不能超过100个字符");
  } else if (input.name.trim().length < 2) {
    errors.push("模板名称至少需要2个字符");
  }
  if (!isNonEmptyString(input.category)) {
    errors.push("藏品类型不能为空");
  } else if (input.category.trim().length > 50) {
    errors.push("藏品类型不能超过50个字符");
  } else if (input.category.trim().length < 2) {
    errors.push("藏品类型至少需要2个字符");
  }
  if (!isNonEmptyString(input.steps)) {
    errors.push("默认步骤不能为空");
  } else if (input.steps.trim().length < 10) {
    errors.push("默认步骤描述过短，请详细说明修复流程");
  }
  if (!isNonEmptyString(input.materials)) {
    errors.push("建议材料不能为空");
  } else if (input.materials.trim().length < 2) {
    errors.push("建议材料至少需要2个字符");
  }
  if (!isPositiveInteger(input.estimatedDays)) {
    errors.push("预计工期必须是正整数（天）");
  } else if (Number(input.estimatedDays) > 365) {
    errors.push("预计工期不能超过365天");
  }
  if (input.reviewRequired !== undefined && !isBoolean(input.reviewRequired)) {
    errors.push("是否需要复核格式不正确");
  }
  if (input.reviewNotes !== undefined && input.reviewNotes !== null && typeof input.reviewNotes !== "string") {
    errors.push("复核要求格式不正确");
  } else if (input.reviewNotes && input.reviewNotes.trim().length > 500) {
    errors.push("复核要求不能超过500个字符");
  }

  const name = input.name ? input.name.trim() : "";
  const category = input.category ? input.category.trim() : "";
  if (name && category) {
    const duplicate = existingTemplates.find((t) =>
      t.name.trim() === name &&
      t.category.trim() === category &&
      t.id !== excludeId
    );
    if (duplicate) {
      errors.push(`该藏品类型下已存在名为"${name}"的模板`);
    }
  }

  return errors;
}

export function validateProject(input, { templates = [] } = {}) {
  const errors = [];
  if (!isNonEmptyString(input.title)) {
    errors.push("藏品名称不能为空");
  }
  if (!isNonEmptyString(input.era)) {
    errors.push("年代不能为空");
  }
  if (!isNonEmptyString(input.damage)) {
    errors.push("破损类型不能为空");
  }
  if (!isNonEmptyString(input.steps)) {
    errors.push("修复步骤不能为空");
  }
  if (!isNonEmptyString(input.materials)) {
    errors.push("使用材料不能为空");
  }
  if (!isNonEmptyString(input.owner)) {
    errors.push("负责人不能为空");
  }
  if (!isValidDateString(input.dueDate)) {
    errors.push("预计完成日期格式不正确");
  }
  if (input.templateId) {
    const templateExists = templates.some((t) => t.id === input.templateId);
    if (!templateExists) {
      errors.push("所选流程模板不存在");
    }
  }
  if (input.photos !== undefined && input.photos !== null && typeof input.photos !== "string") {
    errors.push("照片链接格式不正确");
  }
  return errors;
}
