import { sendJson } from "../db.js";
import { filterProjectsByPermission, isOverdue, isPendingReview, getViewer } from "../utils/permissions.js";

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getWeekDates(weekStart) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    dates.push(formatDate(addDays(weekStart, i)));
  }
  return dates;
}

function getDayOfWeek(dateStr) {
  return new Date(dateStr).getDay();
}

function enrichProject(project) {
  return {
    id: project.id,
    title: project.title,
    era: project.era,
    owner: project.owner,
    dueDate: project.dueDate,
    status: project.status,
    damage: project.damage,
    isOverdue: isOverdue(project),
    isPendingReview: isPendingReview(project)
  };
}

function buildWeeks(projects, rangeStart, rangeEnd) {
  const weeks = [];
  const dayMap = {};

  projects.forEach((p) => {
    if (!p.dueDate) return;
    if (p.dueDate < rangeStart || p.dueDate > rangeEnd) return;
    if (!dayMap[p.dueDate]) dayMap[p.dueDate] = [];
    dayMap[p.dueDate].push(enrichProject(p));
  });

  let cursor = new Date(rangeStart);
  const end = new Date(rangeEnd);

  while (cursor <= end) {
    const weekStart = getWeekStart(cursor);
    const weekEnd = addDays(weekStart, 6);
    const weekLabel = `${formatDate(weekStart)} ~ ${formatDate(weekEnd)}`;
    const monthLabel = `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月第${Math.ceil((weekStart.getDate() - 1) / 7) + 1}周`;
    const dates = getWeekDates(weekStart);

    const days = dates.map((d) => ({
      date: d,
      dayOfWeek: getDayOfWeek(d),
      isToday: d === formatDate(new Date()),
      isWeekend: getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6,
      projects: dayMap[d] || []
    }));

    const weekProjectCount = days.reduce((sum, day) => sum + day.projects.length, 0);
    const overdueCount = days.reduce(
      (sum, day) => sum + day.projects.filter((p) => p.isOverdue).length,
      0
    );
    const pendingReviewCount = days.reduce(
      (sum, day) => sum + day.projects.filter((p) => p.isPendingReview).length,
      0
    );

    weeks.push({
      weekLabel,
      monthLabel,
      weekStart: formatDate(weekStart),
      weekEnd: formatDate(weekEnd),
      projectCount: weekProjectCount,
      overdueCount,
      pendingReviewCount,
      days
    });

    cursor = addDays(weekEnd, 1);
  }

  return weeks;
}

export async function handleCalendar(req, res, db, pathname) {
  if (req.method !== "GET") return false;
  if (pathname !== "/api/calendar") return false;

  const viewerId = req.headers["x-viewer-id"];
  const viewer = getViewer(db, viewerId);
  if (!viewer) return sendJson(res, 401, { error: "unauthorized" });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const weeksParam = parseInt(url.searchParams.get("weeks") || "6", 10);
  const weeksCount = Math.max(1, Math.min(12, weeksParam));

  const today = new Date();
  const rangeStart = formatDate(getWeekStart(today));
  const rangeEnd = formatDate(addDays(getWeekStart(today), weeksCount * 7 - 1));

  const visibleProjects = filterProjectsByPermission(db, viewerId);
  const weeks = buildWeeks(visibleProjects, rangeStart, rangeEnd);

  const stats = {
    total: visibleProjects.length,
    active: visibleProjects.filter((p) => p.status !== "已完成").length,
    overdue: visibleProjects.filter(isOverdue).length,
    pendingReview: visibleProjects.filter(isPendingReview).length
  };

  return sendJson(res, 200, {
    viewer: { id: viewer.id, name: viewer.name, role: viewer.role },
    rangeStart,
    rangeEnd,
    weeksCount,
    stats,
    weeks
  });
}
