import { parseBody, saveDb, sendJson } from "../db.js";
import { createSystemRecord } from "../utils/timeline.js";
import { recordAudit, ACTION_TYPES, SOURCES } from "../utils/audit.js";
import { deepClone } from "../utils/diff.js";

export async function handleReviews(req, res, db, pathname) {
  const isPendingReview = req.method === "GET" && pathname === "/api/projects/pending-review";
  const reviewMatch = pathname.match(/^\/api\/projects\/([^/]+)\/review$/);
  const historyMatch = pathname.match(/^\/api\/projects\/([^/]+)\/review-history$/);

  if (!isPendingReview && !(reviewMatch && req.method === "POST") && !(historyMatch && req.method === "GET")) {
    return false;
  }

  const viewerId = req.headers["x-viewer-id"];
  const viewer = db.users.find((u) => u.id === viewerId);

  if (!viewer || viewer.role !== "admin") {
    return sendJson(res, 403, { error: "forbidden", message: "仅管理员可访问复核功能" });
  }

  if (isPendingReview) {
    const pending = db.projects.filter((p) => p.status === "待复核");
    return sendJson(res, 200, pending);
  }

  if (reviewMatch && req.method === "POST") {
    const project = db.projects.find((item) => item.id === reviewMatch[1]);
    if (!project) return sendJson(res, 404, { error: "project_not_found" });
    if (project.status !== "待复核") {
      return sendJson(res, 400, { error: "invalid_status", message: "该项目状态不是待复核" });
    }

    const input = await parseBody(req);
    const { result, opinion } = input;

    if (!result || !["通过", "退回"].includes(result)) {
      return sendJson(res, 400, { error: "invalid_result", message: "复核结果必须为'通过'或'退回'" });
    }
    if (!opinion || opinion.trim() === "") {
      return sendJson(res, 400, { error: "invalid_opinion", message: "请填写复核意见" });
    }

    const beforeState = deepClone(project);

    const reviewRecord = {
      reviewer: viewer.name,
      reviewerId: viewer.id,
      opinion: opinion.trim(),
      result,
      reviewedAt: new Date().toISOString().slice(0, 10)
    };

    const oldStatus = project.status;
    const newStatus = result === "通过" ? "已完成" : "进行中";

    project.reviewRecords.push(reviewRecord);
    project.status = newStatus;
    project.updatedAt = new Date().toISOString().slice(0, 10);

    if (!project.timelineRecords) project.timelineRecords = [];
    project.timelineRecords.push(createSystemRecord({
      operator: viewer.name,
      operatorId: viewer.id,
      oldStatus,
      newStatus
    }));

    const actionType = result === "通过" ? ACTION_TYPES.REVIEW_PASS : ACTION_TYPES.REVIEW_REJECT;
    recordAudit(db, {
      projectId: project.id,
      actionType,
      operator: viewer.name,
      operatorId: viewer.id,
      source: SOURCES.REVIEW,
      beforeState,
      afterState: deepClone(project),
      note: `复核意见：${opinion.trim()}`
    });

    await saveDb(db);
    return sendJson(res, 200, { project, reviewRecord });
  }

  if (historyMatch && req.method === "GET") {
    const project = db.projects.find((item) => item.id === historyMatch[1]);
    if (!project) return sendJson(res, 404, { error: "project_not_found" });
    return sendJson(res, 200, project.reviewRecords || []);
  }

  return false;
}
