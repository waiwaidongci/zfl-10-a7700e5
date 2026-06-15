import { parseBody, saveDb, sendJson } from "../db.js";
import { validateTemplate } from "../utils/validation.js";
import { bumpVersion, createSnapshot, createTemplateVersionRecord, applyTemplateToProject } from "../utils/templateSnapshots.js";
import { getViewer } from "../utils/permissions.js";

function requireAdmin(req, res, db) {
  const viewerId = req.headers["x-viewer-id"];
  const viewer = getViewer(db, viewerId);
  if (!viewer || viewer.role !== "admin") {
    sendJson(res, 403, { error: "forbidden", message: "仅管理员可执行此操作" });
    return null;
  }
  return viewer;
}

export async function handleTemplates(req, res, db, pathname) {
  if (req.method === "GET" && pathname === "/api/templates") {
    return sendJson(res, 200, db.templates);
  }

  if (req.method === "GET" && pathname === "/api/templates/categories") {
    const categories = [...new Set(db.templates.map((t) => t.category))].sort();
    return sendJson(res, 200, categories);
  }

  if (req.method === "POST" && pathname === "/api/templates") {
    const viewer = requireAdmin(req, res, db);
    if (!viewer) return true;
    const input = await parseBody(req);
    const errors = validateTemplate(input, { existingTemplates: db.templates });
    if (errors.length > 0) {
      return sendJson(res, 400, { error: "validation_failed", errors });
    }
    const template = {
      id: `TPL-${Date.now()}`,
      name: input.name.trim(),
      category: input.category.trim(),
      version: 1,
      steps: input.steps.trim(),
      materials: input.materials.trim(),
      estimatedDays: Number(input.estimatedDays),
      reviewRequired: input.reviewRequired !== false,
      reviewNotes: (input.reviewNotes || "").trim(),
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10)
    };
    db.templates.unshift(template);
    if (!db.templateVersions) db.templateVersions = [];
    db.templateVersions.unshift(createTemplateVersionRecord(template, { operator: viewer.name, operatorId: viewer.id }));
    await saveDb(db);
    return sendJson(res, 201, template);
  }

  const match = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (match) {
    const template = db.templates.find((item) => item.id === match[1]);
    if (!template) return sendJson(res, 404, { error: "template_not_found" });

    if (req.method === "GET") {
      return sendJson(res, 200, template);
    }

    if (req.method === "PATCH") {
      const viewer = requireAdmin(req, res, db);
      if (!viewer) return true;
      const input = await parseBody(req);
      const merged = { ...template, ...input };
      const errors = validateTemplate(merged, { existingTemplates: db.templates, excludeId: template.id });
      if (errors.length > 0) {
        return sendJson(res, 400, { error: "validation_failed", errors });
      }
      const newVersion = bumpVersion(template);
      Object.assign(template, {
        name: input.name ? input.name.trim() : template.name,
        category: input.category ? input.category.trim() : template.category,
        version: newVersion,
        steps: input.steps ? input.steps.trim() : template.steps,
        materials: input.materials ? input.materials.trim() : template.materials,
        estimatedDays: input.estimatedDays !== undefined ? Number(input.estimatedDays) : template.estimatedDays,
        reviewRequired: input.reviewRequired !== undefined ? input.reviewRequired : template.reviewRequired,
        reviewNotes: input.reviewNotes !== undefined ? (input.reviewNotes || "").trim() : template.reviewNotes,
        updatedAt: new Date().toISOString().slice(0, 10)
      });
      if (!db.templateVersions) db.templateVersions = [];
      db.templateVersions.unshift(createTemplateVersionRecord(template, { operator: viewer.name, operatorId: viewer.id }));
      await saveDb(db);
      return sendJson(res, 200, template);
    }

    if (req.method === "DELETE") {
      const viewer = requireAdmin(req, res, db);
      if (!viewer) return true;
      const idx = db.templates.findIndex((item) => item.id === match[1]);
      if (idx > -1) db.templates.splice(idx, 1);
      await saveDb(db);
      return sendJson(res, 200, { success: true });
    }
  }

  const versionMatch = pathname.match(/^\/api\/templates\/([^/]+)\/versions$/);
  if (versionMatch && req.method === "GET") {
    const templateId = versionMatch[1];
    const template = db.templates.find((item) => item.id === templateId);
    if (!template) return sendJson(res, 404, { error: "template_not_found" });
    const versions = (db.templateVersions || []).filter((v) => v.templateId === templateId);
    versions.sort((a, b) => b.version - a.version);
    return sendJson(res, 200, versions);
  }

  const previewMatch = pathname.match(/^\/api\/templates\/([^/]+)\/preview$/);
  if (previewMatch && req.method === "GET") {
    const templateId = previewMatch[1];
    const template = db.templates.find((item) => item.id === templateId);
    if (!template) return sendJson(res, 404, { error: "template_not_found" });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const baseDate = url.searchParams.get("baseDate") || new Date().toISOString().slice(0, 10);
    const applied = applyTemplateToProject(template, { baseDate: new Date(baseDate) });
    return sendJson(res, 200, {
      template: {
        id: template.id,
        name: template.name,
        category: template.category,
        version: template.version,
        reviewRequired: template.reviewRequired,
        reviewNotes: template.reviewNotes
      },
      applied
    });
  }

  const snapshotMatch = pathname.match(/^\/api\/templates\/([^/]+)\/snapshot$/);
  if (snapshotMatch && req.method === "GET") {
    const templateId = snapshotMatch[1];
    const template = db.templates.find((item) => item.id === templateId);
    if (!template) return sendJson(res, 404, { error: "template_not_found" });
    return sendJson(res, 200, createSnapshot(template));
  }

  return false;
}
