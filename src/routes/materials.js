import { parseBody, saveDb, sendJson } from "../db.js";

function validateMaterial(input) {
  const errors = [];
  if (!input.name || input.name.trim() === "") {
    errors.push("材料名称不能为空");
  }
  if (!input.unit || input.unit.trim() === "") {
    errors.push("单位不能为空");
  }
  const quantity = Number(input.quantity);
  if (isNaN(quantity) || quantity < 0) {
    errors.push("库存数量必须是非负数字");
  }
  const threshold = Number(input.lowStockThreshold);
  if (isNaN(threshold) || threshold < 0) {
    errors.push("低库存阈值必须是非负数字");
  }
  return errors;
}

export async function handleMaterials(req, res, db, pathname) {
  if (req.method === "GET" && pathname === "/api/materials") {
    return sendJson(res, 200, db.materials);
  }

  if (req.method === "GET" && pathname === "/api/materials/movements") {
    const movements = db.materialMovements || [];
    return sendJson(res, 200, movements);
  }

  if (req.method === "POST" && pathname === "/api/materials") {
    const input = await parseBody(req);
    const errors = validateMaterial(input);
    if (errors.length > 0) {
      return sendJson(res, 400, { error: "validation_failed", errors });
    }
    const material = {
      id: `M-${Date.now()}`,
      name: input.name.trim(),
      unit: input.unit.trim(),
      quantity: Number(input.quantity),
      lowStockThreshold: Number(input.lowStockThreshold),
      updatedAt: new Date().toISOString().slice(0, 10)
    };
    db.materials.unshift(material);
    await saveDb(db);
    return sendJson(res, 201, material);
  }

  const match = pathname.match(/^\/api\/materials\/([^/]+)$/);
  if (match) {
    const material = db.materials.find((item) => item.id === match[1]);
    if (!material) return sendJson(res, 404, { error: "material_not_found" });

    if (req.method === "GET") {
      return sendJson(res, 200, material);
    }

    if (req.method === "PATCH") {
      const input = await parseBody(req);
      const errors = validateMaterial({ ...material, ...input });
      if (errors.length > 0) {
        return sendJson(res, 400, { error: "validation_failed", errors });
      }
      const oldQuantity = material.quantity;
      const newQuantity = input.quantity !== undefined ? Number(input.quantity) : material.quantity;
      Object.assign(material, input, {
        name: input.name ? input.name.trim() : material.name,
        unit: input.unit ? input.unit.trim() : material.unit,
        quantity: newQuantity,
        lowStockThreshold: input.lowStockThreshold !== undefined ? Number(input.lowStockThreshold) : material.lowStockThreshold,
        updatedAt: new Date().toISOString().slice(0, 10)
      });
      if (newQuantity !== oldQuantity) {
        const diff = newQuantity - oldQuantity;
        const movement = {
          id: `MM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          materialId: material.id,
          materialName: material.name,
          unit: material.unit,
          type: diff > 0 ? "restock" : "consume",
          quantity: Math.abs(diff),
          balanceAfter: newQuantity,
          referenceType: "manual_edit",
          referenceId: material.id,
          projectId: null,
          operator: "",
          operatorId: "",
          note: diff > 0 ? `手动入库 +${Math.abs(diff)}${material.unit}` : `手动调整 -${Math.abs(diff)}${material.unit}`,
          createdAt: new Date().toISOString()
        };
        if (!db.materialMovements) db.materialMovements = [];
        db.materialMovements.unshift(movement);
      }
      await saveDb(db);
      return sendJson(res, 200, material);
    }

    if (req.method === "DELETE") {
      const idx = db.materials.findIndex((item) => item.id === match[1]);
      if (idx > -1) db.materials.splice(idx, 1);
      await saveDb(db);
      return sendJson(res, 200, { success: true });
    }
  }

  return false;
}
