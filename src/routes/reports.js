import { sendJson } from "../db.js";
import { getViewer } from "../utils/permissions.js";
import { sortRecords } from "../utils/timeline.js";

function sanitizeArchive(archive) {
  const result = { before: [], during: [], after: [] };
  ["before", "during", "after"].forEach(function(stage) {
    const arr = (archive && archive[stage]) || [];
    result[stage] = arr.filter(function(url) {
      return typeof url === "string" && url.trim() !== "";
    });
  });
  return result;
}

function buildReportData(project, db) {
  const archive = sanitizeArchive(project.photoArchive);
  const photoCount = archive.before.length + archive.during.length + archive.after.length;
  const timelineRecords = sortRecords(project.timelineRecords || []);
  const manualRecords = timelineRecords.filter(r => r.type === "manual");
  const reviewRecords = project.reviewRecords || [];

  let completionDate = null;
  for (let i = timelineRecords.length - 1; i >= 0; i--) {
    const r = timelineRecords[i];
    if (r.type === "system" && r.systemMessage && r.systemMessage.includes("已完成")) {
      completionDate = r.date;
      break;
    }
  }
  if (!completionDate && project.status === "已完成") {
    completionDate = project.updatedAt;
  }

  let lastRejection = null;
  for (let i = reviewRecords.length - 1; i >= 0; i--) {
    if (reviewRecords[i].result === "退回") {
      lastRejection = {
        reviewer: reviewRecords[i].reviewer,
        opinion: reviewRecords[i].opinion,
        reviewedAt: reviewRecords[i].reviewedAt
      };
      break;
    }
  }

  let templateInfo = null;
  let reviewRequirements = "";
  if (project.templateSnapshot) {
    templateInfo = {
      templateId: project.templateSnapshot.templateId,
      templateName: project.templateSnapshot.templateName,
      templateCategory: project.templateSnapshot.templateCategory,
      templateVersion: project.templateSnapshot.templateVersion,
      estimatedDays: project.templateSnapshot.estimatedDays,
      reviewRequired: project.templateSnapshot.reviewRequired,
      appliedAt: project.templateSnapshot.appliedAt
    };
    reviewRequirements = project.templateSnapshot.reviewNotes || "";
  } else if (project.templateId && db) {
    const tpl = db.templates && db.templates.find(function(t) { return t.id === project.templateId; });
    if (tpl) {
      templateInfo = {
        templateId: tpl.id,
        templateName: tpl.name,
        templateCategory: tpl.category,
        templateVersion: tpl.version || 1,
        estimatedDays: tpl.estimatedDays,
        reviewRequired: tpl.reviewRequired
      };
      reviewRequirements = tpl.reviewNotes || "";
    }
  }

  return {
    project: {
      id: project.id,
      title: project.title,
      era: project.era,
      owner: project.owner,
      status: project.status,
      dueDate: project.dueDate,
      updatedAt: project.updatedAt,
      completionDate: completionDate
    },
    artifact: {
      title: project.title,
      era: project.era,
      damage: project.damage
    },
    restoration: {
      steps: project.steps,
      materials: project.materials
    },
    template: templateInfo,
    reviewRequirements: reviewRequirements,
    process: {
      records: manualRecords,
      hasRecords: manualRecords.length > 0,
      totalRecords: manualRecords.length
    },
    photos: {
      archive: archive,
      total: photoCount,
      hasPhotos: photoCount > 0,
      beforeCount: archive.before.length,
      duringCount: archive.during.length,
      afterCount: archive.after.length
    },
    reviews: {
      records: reviewRecords,
      hasReviews: reviewRecords.length > 0,
      totalReviews: reviewRecords.length,
      lastReview: reviewRecords.length > 0 ? reviewRecords[reviewRecords.length - 1] : null,
      lastRejection: lastRejection
    },
    generatedAt: new Date().toISOString()
  };
}

export async function handleReports(req, res, db, pathname) {
  const match = pathname.match(/^\/api\/projects\/([^/]+)\/report$/);

  if (match && req.method === "GET") {
    const viewerId = req.headers["x-viewer-id"];
    const viewer = getViewer(db, viewerId);

    if (!viewer) {
      return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
    }

    if (viewer.role !== "admin") {
      return sendJson(res, 403, { error: "forbidden", message: "仅管理员可生成修复报告" });
    }

    const project = db.projects.find((item) => item.id === match[1]);
    if (!project) {
      return sendJson(res, 404, { error: "project_not_found", message: "项目不存在" });
    }

    if (project.status !== "已完成") {
      return sendJson(res, 400, { error: "project_not_completed", message: "仅已完成项目可生成修复报告" });
    }

    const report = buildReportData(project, db);
    return sendJson(res, 200, report);
  }

  return false;
}
