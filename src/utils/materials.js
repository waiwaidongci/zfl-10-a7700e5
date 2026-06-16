export function validateMaterialUsages(materialUsages, db) {
  const errors = [];
  if (!materialUsages || !Array.isArray(materialUsages)) {
    return errors;
  }

  const seenMaterialIds = new Set();
  for (let i = 0; i < materialUsages.length; i++) {
    const usage = materialUsages[i];
    if (!usage.materialId || usage.materialId.trim() === "") {
      errors.push({ field: `materialUsages[${i}].materialId`, message: "材料ID不能为空" });
      continue;
    }

    if (seenMaterialIds.has(usage.materialId)) {
      errors.push({ field: `materialUsages[${i}].materialId`, message: "材料不能重复选择" });
      continue;
    }
    seenMaterialIds.add(usage.materialId);

    const material = db.materials.find((m) => m.id === usage.materialId);
    if (!material) {
      errors.push({ field: `materialUsages[${i}].materialId`, message: "材料不存在" });
      continue;
    }

    const quantity = Number(usage.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      errors.push({ field: `materialUsages[${i}].quantity`, message: `${material.name} 的消耗数量必须是正数` });
      continue;
    }
  }

  return errors;
}

export function checkStockSufficiency(materialUsages, db) {
  const shortages = [];
  if (!materialUsages || !Array.isArray(materialUsages)) {
    return shortages;
  }

  for (const usage of materialUsages) {
    const material = db.materials.find((m) => m.id === usage.materialId);
    if (!material) continue;

    const quantity = Number(usage.quantity);
    if (material.quantity < quantity) {
      shortages.push({
        materialId: material.id,
        materialName: material.name,
        unit: material.unit,
        required: quantity,
        available: material.quantity,
        shortage: quantity - material.quantity
      });
    }
  }

  return shortages;
}

export function consumeMaterials(materialUsages, db, projectId, timelineRecordId, operator, operatorId) {
  const movements = [];
  if (!materialUsages || !Array.isArray(materialUsages)) {
    return movements;
  }

  for (const usage of materialUsages) {
    const material = db.materials.find((m) => m.id === usage.materialId);
    if (!material) continue;

    const quantity = Number(usage.quantity);
    material.quantity = material.quantity - quantity;
    material.updatedAt = new Date().toISOString().slice(0, 10);

    const movement = {
      id: `MM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      materialId: material.id,
      materialName: material.name,
      unit: material.unit,
      type: "consume",
      quantity: quantity,
      balanceAfter: material.quantity,
      referenceType: "timeline",
      referenceId: timelineRecordId,
      projectId: projectId,
      operator: operator || "",
      operatorId: operatorId || "",
      note: `修复过程消耗`,
      createdAt: new Date().toISOString()
    };
    movements.push(movement);
    db.materialMovements.unshift(movement);
  }

  return movements;
}

export function restoreMaterials(timelineRecord, db) {
  if (!timelineRecord || !timelineRecord.materialUsages || !Array.isArray(timelineRecord.materialUsages)) {
    return [];
  }

  const restoredMovements = [];
  for (const usage of timelineRecord.materialUsages) {
    const material = db.materials.find((m) => m.id === usage.materialId);
    if (!material) continue;

    const quantity = Number(usage.quantity);
    material.quantity = material.quantity + quantity;
    material.updatedAt = new Date().toISOString().slice(0, 10);

    const movement = {
      id: `MM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      materialId: material.id,
      materialName: material.name,
      unit: material.unit,
      type: "restore",
      quantity: quantity,
      balanceAfter: material.quantity,
      referenceType: "timeline_delete",
      referenceId: timelineRecord.id,
      projectId: null,
      operator: timelineRecord.operator || "",
      operatorId: timelineRecord.operatorId || "",
      note: `删除修复记录，恢复库存`,
      createdAt: new Date().toISOString()
    };
    restoredMovements.push(movement);
    db.materialMovements.unshift(movement);
  }

  const relatedMovementIds = db.materialMovements
    .filter(
      (m) => m.referenceType === "timeline" && m.referenceId === timelineRecord.id
    )
    .map((m) => m.id);

  return restoredMovements;
}

export function formatMaterialUsagesText(materialUsages, db) {
  if (!materialUsages || !Array.isArray(materialUsages) || materialUsages.length === 0) {
    return "";
  }

  const parts = materialUsages.map((usage) => {
    const material = db.materials.find((m) => m.id === usage.materialId);
    const name = material ? material.name : usage.materialId;
    const unit = material ? material.unit : "";
    return `${name} ${usage.quantity}${unit}`;
  });

  return parts.join("、");
}
