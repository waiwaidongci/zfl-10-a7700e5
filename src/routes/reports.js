import { sendJson, parseBody, saveDb } from "../db.js";
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

export function buildReportData(project, db) {
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

function generateSnapshotId(projectId) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `RS-${projectId}-${timestamp}-${random}`;
}

async function createReportSnapshot(req, res, db, projectId) {
  const viewerId = req.headers["x-viewer-id"];
  const viewer = getViewer(db, viewerId);

  if (!viewer) {
    return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
  }

  if (viewer.role !== "admin") {
    return sendJson(res, 403, { error: "forbidden", message: "仅管理员可归档报告快照" });
  }

  const project = db.projects.find((item) => item.id === projectId);
  if (!project) {
    return sendJson(res, 404, { error: "project_not_found", message: "项目不存在" });
  }

  if (project.status !== "已完成") {
    return sendJson(res, 400, { error: "project_not_completed", message: "仅已完成项目可归档报告快照" });
  }

  const reportData = buildReportData(project, db);
  const body = await parseBody(req);
  const snapshotId = generateSnapshotId(projectId);
  const snapshot = {
    id: snapshotId,
    projectId: projectId,
    snapshotName: body && body.name ? body.name : `报告快照 ${new Date().toISOString().slice(0, 10)}`,
    note: body && body.note ? body.note : "",
    archivedBy: viewer.name,
    archivedById: viewer.id,
    archivedAt: new Date().toISOString(),
    projectVersion: project.version || 1,
    data: reportData
  };

  if (!Array.isArray(db.reportSnapshots)) {
    db.reportSnapshots = [];
  }
  db.reportSnapshots.push(snapshot);
  await saveDb(db);

  return sendJson(res, 200, {
    ok: true,
    snapshot: {
      id: snapshot.id,
      projectId: snapshot.projectId,
      snapshotName: snapshot.snapshotName,
      note: snapshot.note,
      archivedBy: snapshot.archivedBy,
      archivedAt: snapshot.archivedAt,
      projectVersion: snapshot.projectVersion
    }
  });
}

function listReportSnapshots(req, res, db, projectId) {
  const viewerId = req.headers["x-viewer-id"];
  const viewer = getViewer(db, viewerId);

  if (!viewer) {
    return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
  }

  const project = db.projects.find((item) => item.id === projectId);
  if (!project) {
    return sendJson(res, 404, { error: "project_not_found", message: "项目不存在" });
  }

  if (viewer.role !== "admin" && project.owner !== viewer.name) {
    return sendJson(res, 403, { error: "forbidden", message: "无权限查看该项目的报告快照" });
  }

  const snapshots = (db.reportSnapshots || [])
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt))
    .map((s) => ({
      id: s.id,
      projectId: s.projectId,
      snapshotName: s.snapshotName,
      note: s.note,
      archivedBy: s.archivedBy,
      archivedAt: s.archivedAt,
      projectVersion: s.projectVersion
    }));

  return sendJson(res, 200, { snapshots: snapshots });
}

function getReportSnapshot(req, res, db, projectId, snapshotId) {
  const viewerId = req.headers["x-viewer-id"];
  const viewer = getViewer(db, viewerId);

  if (!viewer) {
    return sendJson(res, 401, { error: "unauthorized", message: "请先登录" });
  }

  const project = db.projects.find((item) => item.id === projectId);
  if (!project) {
    return sendJson(res, 404, { error: "project_not_found", message: "项目不存在" });
  }

  if (viewer.role !== "admin" && project.owner !== viewer.name) {
    return sendJson(res, 403, { error: "forbidden", message: "无权限查看该项目的报告快照" });
  }

  const snapshot = (db.reportSnapshots || []).find((s) => s.id === snapshotId && s.projectId === projectId);
  if (!snapshot) {
    return sendJson(res, 404, { error: "snapshot_not_found", message: "报告快照不存在" });
  }

  return sendJson(res, 200, {
    id: snapshot.id,
    projectId: snapshot.projectId,
    snapshotName: snapshot.snapshotName,
    note: snapshot.note,
    archivedBy: snapshot.archivedBy,
    archivedAt: snapshot.archivedAt,
    projectVersion: snapshot.projectVersion,
    data: snapshot.data
  });
}

export async function handleReports(req, res, db, pathname) {
  const listMatch = pathname.match(/^\/api\/projects\/([^/]+)\/report-snapshots$/);
  if (listMatch) {
    const projectId = listMatch[1];
    if (req.method === "GET") {
      return listReportSnapshots(req, res, db, projectId);
    }
    if (req.method === "POST") {
      return createReportSnapshot(req, res, db, projectId);
    }
    return sendJson(res, 405, { error: "method_not_allowed" });
  }

  const detailMatch = pathname.match(/^\/api\/projects\/([^/]+)\/report-snapshots\/([^/]+)$/);
  if (detailMatch && req.method === "GET") {
    const projectId = detailMatch[1];
    const snapshotId = detailMatch[2];
    return getReportSnapshot(req, res, db, projectId, snapshotId);
  }

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
