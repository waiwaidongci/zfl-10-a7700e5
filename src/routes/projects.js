import { parseBody, saveDb, sendJson } from "../db.js";
import { createSystemRecord } from "../utils/timeline.js";
import { createSnapshot, applyTemplateToProject } from "../utils/templateSnapshots.js";
import { validateProject } from "../utils/validation.js";
import { getViewer } from "../utils/permissions.js";

function sanitizeProjectInput(input) {
  const out = {};
  if (input.title !== undefined) out.title = String(input.title).trim();
  if (input.era !== undefined) out.era = String(input.era).trim();
  if (input.damage !== undefined) out.damage = String(input.damage).trim();
  if (input.steps !== undefined) out.steps = String(input.steps).trim();
  if (input.materials !== undefined) out.materials = String(input.materials).trim();
  if (input.owner !== undefined) out.owner = String(input.owner).trim();
  if (input.dueDate !== undefined) out.dueDate = String(input.dueDate).trim();
  if (input.photos !== undefined) out.photos = String(input.photos || "").trim();
  if (input.status !== undefined) out.status = String(input.status).trim();
  if (input.templateId !== undefined) out.templateId = String(input.templateId).trim() || null;
  return out;
}

export async function handleProjects(req, res, db, pathname) {
  if (req.method === "GET" && pathname === "/api/projects") {
    return sendJson(res, 200, db.projects);
  }

  if (req.method === "POST" && pathname === "/api/projects/apply-template") {
    const input = await parseBody(req);
    const templateId = input.templateId;
    if (!templateId) {
      return sendJson(res, 400, { error: "template_id_required" });
    }
    const template = db.templates.find((t) => t.id === templateId);
    if (!template) {
      return sendJson(res, 404, { error: "template_not_found" });
    }
    const baseDate = input.baseDate ? new Date(input.baseDate) : new Date();
    const applied = applyTemplateToProject(template, { baseDate });
    return sendJson(res, 200, {
      snapshot: createSnapshot(template),
      applied
    });
  }

  if (req.method === "POST" && pathname === "/api/projects") {
    const rawInput = await parseBody(req);
    const input = sanitizeProjectInput(rawInput);

    let templateSnapshot = null;
    if (input.templateId) {
      const template = db.templates.find((t) => t.id === input.templateId);
      if (template) {
        templateSnapshot = createSnapshot(template);
        const applied = applyTemplateToProject(template);
        if (!input.steps || !input.steps.trim()) input.steps = applied.steps;
        if (!input.materials || !input.materials.trim()) input.materials = applied.materials;
        if (!input.dueDate || !input.dueDate.trim()) input.dueDate = applied.dueDate;
      }
    }
    delete input.templateId;

    const errors = validateProject(input, { templates: db.templates });
    if (errors.length > 0) {
      return sendJson(res, 400, { error: "validation_failed", errors });
    }

    const project = {
      id: `R-${Date.now()}`,
      status: "进行中",
      updatedAt: new Date().toISOString().slice(0, 10),
      reviewRecords: [],
      timelineRecords: [],
      photoArchive: { before: [], during: [], after: [] },
      templateSnapshot,
      ...input
    };
    db.projects.unshift(project);
    await saveDb(db);
    return sendJson(res, 201, project);
  }

  const match = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (match && req.method === "PATCH") {
    const project = db.projects.find((item) => item.id === match[1]);
    if (!project) return sendJson(res, 404, { error: "project_not_found" });
    const oldStatus = project.status;
    const rawBody = await parseBody(req);
    const body = sanitizeProjectInput(rawBody);

    if (body.templateId) {
      if (project.templateSnapshot) {
        delete body.templateId;
      } else {
        const template = db.templates.find((t) => t.id === body.templateId);
        if (template) {
          project.templateSnapshot = createSnapshot(template);
        }
        delete body.templateId;
      }
    }

    Object.assign(project, body, { updatedAt: new Date().toISOString().slice(0, 10) });

    if (body.status && body.status !== oldStatus) {
      const viewerId = req.headers["x-viewer-id"];
      const viewer = getViewer(db, viewerId);
      if (!project.timelineRecords) project.timelineRecords = [];
      project.timelineRecords.push(createSystemRecord({
        operator: viewer ? viewer.name : "未知用户",
        operatorId: viewerId || "",
        oldStatus,
        newStatus: body.status
      }));
    }

    await saveDb(db);
    return sendJson(res, 200, project);
  }

  return false;
}
