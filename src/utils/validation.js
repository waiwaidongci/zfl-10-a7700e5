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

export function isSafeString(value) {
  if (typeof value !== "string") return false;
  const dangerousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /eval\(/gi,
    /expression\(/gi
  ];
  return !dangerousPatterns.some((pattern) => pattern.test(value));
}

export function isValidTemplateId(value) {
  if (typeof value !== "string") return false;
  return /^TPL-\d+$/.test(value) || /^TPL-[a-z0-9]+$/.test(value);
}

export function isValidVersion(value) {
  const num = Number(value);
  return !isNaN(num) && num >= 1 && Number.isInteger(num);
}

export function validateTemplateSnapshot(snapshot) {
  const errors = [];
  if (snapshot === null || snapshot === undefined) return errors;
  if (typeof snapshot !== "object") {
    errors.push("模板快照格式不正确");
    return errors;
  }
  if (snapshot.templateId && !isValidTemplateId(snapshot.templateId)) {
    errors.push("模板快照中的模板ID格式不正确");
  }
  if (snapshot.templateVersion !== undefined && !isValidVersion(snapshot.templateVersion)) {
    errors.push("模板快照中的版本号格式不正确");
  }
  if (snapshot.steps !== undefined && typeof snapshot.steps !== "string") {
    errors.push("模板快照中的步骤格式不正确");
  }
  if (snapshot.materials !== undefined && typeof snapshot.materials !== "string") {
    errors.push("模板快照中的材料格式不正确");
  }
  if (snapshot.estimatedDays !== undefined && !isPositiveInteger(snapshot.estimatedDays)) {
    errors.push("模板快照中的预计工期格式不正确");
  }
  if (snapshot.reviewRequired !== undefined && !isBoolean(snapshot.reviewRequired)) {
    errors.push("模板快照中的复核要求格式不正确");
  }
  if (snapshot.appliedAt !== undefined && !isValidDateString(snapshot.appliedAt)) {
    errors.push("模板快照中的应用日期格式不正确");
  }
  return errors;
}

export function validateTemplate(input, { existingTemplates = [], excludeId = null } = {}) {
  const errors = [];

  if (input.id !== undefined && !isValidTemplateId(input.id)) {
    errors.push("模板ID格式不正确");
  }
  if (input.version !== undefined && !isValidVersion(input.version)) {
    errors.push("模板版本号格式不正确");
  }

  if (!isNonEmptyString(input.name)) {
    errors.push("模板名称不能为空");
  } else if (input.name.trim().length > 100) {
    errors.push("模板名称不能超过100个字符");
  } else if (input.name.trim().length < 2) {
    errors.push("模板名称至少需要2个字符");
  } else if (!isSafeString(input.name)) {
    errors.push("模板名称包含不安全字符");
  }

  if (!isNonEmptyString(input.category)) {
    errors.push("藏品类型不能为空");
  } else if (input.category.trim().length > 50) {
    errors.push("藏品类型不能超过50个字符");
  } else if (input.category.trim().length < 2) {
    errors.push("藏品类型至少需要2个字符");
  } else if (!isSafeString(input.category)) {
    errors.push("藏品类型包含不安全字符");
  }

  if (!isNonEmptyString(input.steps)) {
    errors.push("默认步骤不能为空");
  } else if (input.steps.trim().length < 10) {
    errors.push("默认步骤描述过短，请详细说明修复流程");
  } else if (!isSafeString(input.steps)) {
    errors.push("默认步骤包含不安全字符");
  }

  if (!isNonEmptyString(input.materials)) {
    errors.push("建议材料不能为空");
  } else if (input.materials.trim().length < 2) {
    errors.push("建议材料至少需要2个字符");
  } else if (!isSafeString(input.materials)) {
    errors.push("建议材料包含不安全字符");
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
  } else if (input.reviewNotes && !isSafeString(input.reviewNotes)) {
    errors.push("复核要求包含不安全字符");
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
  } else if (!isSafeString(input.title)) {
    errors.push("藏品名称包含不安全字符");
  }

  if (!isNonEmptyString(input.era)) {
    errors.push("年代不能为空");
  } else if (!isSafeString(input.era)) {
    errors.push("年代包含不安全字符");
  }

  if (!isNonEmptyString(input.damage)) {
    errors.push("破损类型不能为空");
  } else if (!isSafeString(input.damage)) {
    errors.push("破损类型包含不安全字符");
  }

  if (!isNonEmptyString(input.steps)) {
    errors.push("修复步骤不能为空");
  } else if (!isSafeString(input.steps)) {
    errors.push("修复步骤包含不安全字符");
  }

  if (!isNonEmptyString(input.materials)) {
    errors.push("使用材料不能为空");
  } else if (!isSafeString(input.materials)) {
    errors.push("使用材料包含不安全字符");
  }

  if (!isNonEmptyString(input.owner)) {
    errors.push("负责人不能为空");
  } else if (!isSafeString(input.owner)) {
    errors.push("负责人包含不安全字符");
  }

  if (!isValidDateString(input.dueDate)) {
    errors.push("预计完成日期格式不正确");
  }

  if (input.templateId) {
    if (!isValidTemplateId(input.templateId)) {
      errors.push("模板ID格式不正确");
    } else {
      const templateExists = templates.some((t) => t.id === input.templateId);
      if (!templateExists) {
        errors.push("所选流程模板不存在");
      }
    }
  }

  if (input.templateSnapshot !== undefined && input.templateSnapshot !== null) {
    const snapshotErrors = validateTemplateSnapshot(input.templateSnapshot);
    if (snapshotErrors.length > 0) {
      errors.push(...snapshotErrors);
    }
  }

  if (input.photos !== undefined && input.photos !== null && typeof input.photos !== "string") {
    errors.push("照片链接格式不正确");
  } else if (input.photos && !isSafeString(input.photos)) {
    errors.push("照片链接包含不安全字符");
  }

  return errors;
}
