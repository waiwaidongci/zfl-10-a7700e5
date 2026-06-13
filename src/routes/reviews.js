import { parseBody, saveDb, sendJson } from "../db.js";

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

    const reviewRecord = {
      reviewer: viewer.name,
      reviewerId: viewer.id,
      opinion: opinion.trim(),
      result,
      reviewedAt: new Date().toISOString().slice(0, 10)
    };

    project.reviewRecords.push(reviewRecord);
    project.status = result === "通过" ? "已完成" : "进行中";
    project.updatedAt = new Date().toISOString().slice(0, 10);

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
