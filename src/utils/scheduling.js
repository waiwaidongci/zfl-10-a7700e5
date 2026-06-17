import { isOverdue, isPendingReview } from "./permissions.js";
import { deepClone } from "./diff.js";

const WORK_DAYS_PER_WEEK = 5;
const DEFAULT_HOURS_PER_DAY = 8;
const MAX_WORKLOAD_PER_DAY = DEFAULT_HOURS_PER_DAY;

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(dateStr) {
  return new Date(dateStr + "T00:00:00");
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getWorkDaysBetween(startDate, endDate) {
  let count = 0;
  const current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    if (!isWeekend(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function getNextWorkDay(fromDate) {
  let d = new Date(fromDate);
  while (isWeekend(d)) {
    d = addDays(d, 1);
  }
  return d;
}

function addWorkDays(fromDate, workDays) {
  let d = new Date(fromDate);
  let added = 0;
  while (added < workDays) {
    d = addDays(d, 1);
    if (!isWeekend(d)) added++;
  }
  return d;
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEstimatedDays(project, templates) {
  if (project.templateSnapshot && project.templateSnapshot.estimatedDays) {
    return project.templateSnapshot.estimatedDays;
  }
  if (project.templateId) {
    const tpl = templates.find(t => t.id === project.templateId);
    if (tpl && tpl.estimatedDays) return tpl.estimatedDays;
  }
  return 5;
}

function getProjectPriority(project) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let priority = 0;

  if (project.status === "已完成") return -100;

  if (isPendingReview(project)) priority += 30;

  if (isOverdue(project)) {
    const due = parseDate(project.dueDate);
    const overdueDays = Math.floor((today - due) / (1000 * 60 * 60 * 24));
    priority += 50 + Math.min(overdueDays, 30);
  }

  if (project.dueDate) {
    const due = parseDate(project.dueDate);
    const daysUntilDue = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    if (daysUntilDue <= 3) priority += 25;
    else if (daysUntilDue <= 7) priority += 15;
    else if (daysUntilDue <= 14) priority += 8;
  }

  if (project.status === "进行中") priority += 5;

  return priority;
}

function calculateProjectSchedule(project, templates, startDate, existingAssignments = []) {
  const estimatedDays = getEstimatedDays(project, templates);
  const workDaysNeeded = estimatedDays;

  let currentStart = getNextWorkDay(startDate);

  for (const assignment of existingAssignments) {
    const assignStart = parseDate(assignment.startDate);
    const assignEnd = parseDate(assignment.endDate);
    if (currentStart <= assignEnd && addWorkDays(currentStart, workDaysNeeded - 1) >= assignStart) {
      currentStart = getNextWorkDay(addDays(assignEnd, 1));
    }
  }

  const endDate = addWorkDays(currentStart, workDaysNeeded - 1);

  return {
    projectId: project.id,
    startDate: formatDate(currentStart),
    endDate: formatDate(endDate),
    estimatedDays,
    workDays: workDaysNeeded
  };
}

function generateWorkloadForWorker(workerName, projects, templates, rangeStart, rangeEnd) {
  const workerProjects = projects.filter(p => p.owner === workerName && p.status !== "已完成");

  workerProjects.sort((a, b) => getProjectPriority(b) - getProjectPriority(a));

  const assignments = [];
  const dayWorkload = {};

  let scheduleCursor = new Date(rangeStart);

  for (const project of workerProjects) {
    if (project.status === "已完成") continue;

    if (project.status === "待复核") {
      const schedule = {
        projectId: project.id,
        startDate: formatDate(scheduleCursor),
        endDate: formatDate(scheduleCursor),
        estimatedDays: 1,
        workDays: 1,
        isBlocked: true,
        blockReason: "待复核"
      };
      assignments.push({ ...schedule, project });
      continue;
    }

    const estimatedDays = getEstimatedDays(project, templates);
    const schedule = calculateProjectSchedule(project, templates, scheduleCursor, assignments);

    const projStart = parseDate(schedule.startDate);
    const projEnd = parseDate(schedule.endDate);

    let d = new Date(projStart);
    while (d <= projEnd) {
      if (!isWeekend(d)) {
        const dateStr = formatDate(d);
        if (!dayWorkload[dateStr]) dayWorkload[dateStr] = 0;
        dayWorkload[dateStr] += DEFAULT_HOURS_PER_DAY;
      }
      d = addDays(d, 1);
    }

    assignments.push({ ...schedule, project });

    const endD = parseDate(schedule.endDate);
    if (endD > scheduleCursor) {
      scheduleCursor = getNextWorkDay(addDays(endD, 1));
    }
  }

  const weeks = [];
  let weekCursor = new Date(rangeStart);
  weekCursor = getWeekStart(weekCursor);
  const rangeEndDate = new Date(rangeEnd);

  while (weekCursor <= rangeEndDate) {
    const weekStart = new Date(weekCursor);
    const weekEnd = addDays(weekStart, 6);

    const weekDays = [];
    let weeklyHours = 0;
    let weeklyMaxHours = 0;

    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const dateStr = formatDate(day);
      const workload = dayWorkload[dateStr] || 0;
      const isOverloaded = workload > MAX_WORKLOAD_PER_DAY;
      weeklyHours += workload;
      weeklyMaxHours = Math.max(weeklyMaxHours, workload);

      const dayProjects = assignments.filter(a => {
        const aStart = parseDate(a.startDate);
        const aEnd = parseDate(a.endDate);
        return day >= aStart && day <= aEnd && !isWeekend(day);
      });

      weekDays.push({
        date: dateStr,
        dayOfWeek: day.getDay(),
        isWeekend: isWeekend(day),
        isToday: dateStr === formatDate(new Date()),
        workload,
        maxWorkload: MAX_WORKLOAD_PER_DAY,
        isOverloaded,
        projects: dayProjects.map(a => ({
          id: a.projectId,
          title: a.project.title,
          status: a.project.status,
          owner: a.project.owner,
          dueDate: a.project.dueDate,
          era: a.project.era,
          isOverdue: isOverdue(a.project),
          isPendingReview: isPendingReview(a.project),
          isBlocked: a.isBlocked,
          blockReason: a.blockReason,
          startDate: a.startDate,
          endDate: a.endDate,
          estimatedDays: a.estimatedDays
        }))
      });
    }

    const availableWorkDays = weekDays.filter(d => !d.isWeekend).length;
    const maxWeeklyHours = availableWorkDays * MAX_WORKLOAD_PER_DAY;
    const weekLoadPercent = maxWeeklyHours > 0 ? (weeklyHours / maxWeeklyHours) * 100 : 0;

    weeks.push({
      weekStart: formatDate(weekStart),
      weekEnd: formatDate(weekEnd),
      weekLabel: `${formatDate(weekStart)} ~ ${formatDate(weekEnd)}`,
      monthLabel: `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月第${Math.ceil((weekStart.getDate() - 1) / 7) + 1}周`,
      totalHours: weeklyHours,
      maxHours: maxWeeklyHours,
      loadPercent: weekLoadPercent,
      isOverloaded: weekLoadPercent > 100,
      isHeavyLoad: weekLoadPercent > 80,
      days: weekDays
    });

    weekCursor = addDays(weekCursor, 7);
  }

  return {
    workerName,
    assignments: assignments.map(a => ({
      projectId: a.projectId,
      startDate: a.startDate,
      endDate: a.endDate,
      estimatedDays: a.estimatedDays,
      workDays: a.workDays,
      isBlocked: a.isBlocked || false,
      blockReason: a.blockReason || null,
      project: {
        id: a.project.id,
        title: a.project.title,
        status: a.project.status,
        dueDate: a.project.dueDate,
        era: a.project.era,
        damage: a.project.damage,
        materials: a.project.materials,
        isOverdue: isOverdue(a.project),
        isPendingReview: isPendingReview(a.project),
        priority: getProjectPriority(a.project)
      }
    })),
    weeks,
    stats: {
      totalProjects: assignments.length,
      activeProjects: assignments.filter(a => !a.isBlocked && a.project.status === "进行中").length,
      blockedProjects: assignments.filter(a => a.isBlocked).length,
      overdueProjects: assignments.filter(a => a.project && isOverdue(a.project)).length,
      averageDailyLoad: Object.values(dayWorkload).length > 0
        ? Object.values(dayWorkload).reduce((a, b) => a + b, 0) / Object.values(dayWorkload).length
        : 0,
      maxDailyLoad: Object.values(dayWorkload).length > 0
        ? Math.max(...Object.values(dayWorkload))
        : 0
    }
  };
}

export function detectConflicts(projects, templates, materials) {
  const conflicts = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const workerProjects = {};
  for (const p of projects) {
    if (p.status === "已完成") continue;
    if (!workerProjects[p.owner]) workerProjects[p.owner] = [];
    workerProjects[p.owner].push(p);
  }

  for (const [worker, projs] of Object.entries(workerProjects)) {
    const activeCount = projs.filter(p => p.status === "进行中").length;
    if (activeCount > 3) {
      conflicts.push({
        type: "overload",
        severity: "warning",
        worker,
        message: `${worker} 同时进行 ${activeCount} 个项目，建议不超过 3 个`,
        projectCount: activeCount
      });
    }

    const pendingReviewCount = projs.filter(p => p.status === "待复核").length;
    if (pendingReviewCount > 0) {
      conflicts.push({
        type: "blocked",
        severity: "info",
        worker,
        message: `${worker} 有 ${pendingReviewCount} 个项目待复核，可能阻塞排程`,
        projectCount: pendingReviewCount
      });
    }

    const overdueCount = projs.filter(p => isOverdue(p)).length;
    if (overdueCount > 0) {
      conflicts.push({
        type: "overdue",
        severity: "danger",
        worker,
        message: `${worker} 有 ${overdueCount} 个逾期项目`,
        projectCount: overdueCount
      });
    }
  }

  for (const project of projects) {
    if (project.status === "已完成") continue;

    if (project.materials && project.materials.trim()) {
      const materialNames = project.materials.split(/[、,，\s]+/).filter(m => m.trim());
      for (const matName of materialNames) {
        const material = materials.find(m =>
          m.name.includes(matName) || matName.includes(m.name)
        );
        if (material && material.quantity <= material.lowStockThreshold) {
          conflicts.push({
            type: "material",
            severity: material.quantity === 0 ? "danger" : "warning",
            projectId: project.id,
            projectTitle: project.title,
            materialId: material.id,
            materialName: material.name,
            stock: material.quantity,
            threshold: material.lowStockThreshold,
            message: `项目"${project.title}"所需材料"${material.name}"库存不足（当前：${material.quantity}${material.unit}，阈值：${material.lowStockThreshold}${material.unit}）`
          });
        }
      }
    }

    if (project.dueDate) {
      const estimatedDays = getEstimatedDays(project, templates);
      const due = parseDate(project.dueDate);
      const workDaysAvailable = getWorkDaysBetween(today, due);
      if (workDaysAvailable < estimatedDays && project.status !== "已完成") {
        conflicts.push({
          type: "schedule",
          severity: "danger",
          projectId: project.id,
          projectTitle: project.title,
          message: `项目"${project.title}"工期紧张：预计需要 ${estimatedDays} 个工作日，但距截止日期仅剩 ${workDaysAvailable} 个工作日`,
          estimatedDays,
          availableDays: workDaysAvailable
        });
      }
    }
  }

  return conflicts;
}

export function validateScheduleChange(project, newOwner, newDueDate, db) {
  const warnings = [];
  const errors = [];

  const templates = db.templates;
  const materials = db.materials;

  const estimatedDays = getEstimatedDays(project, templates);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (newDueDate) {
    const due = parseDate(newDueDate);
    const workDaysAvailable = getWorkDaysBetween(today, due);
    if (workDaysAvailable < estimatedDays && project.status !== "已完成") {
      warnings.push({
        type: "tight_schedule",
        message: `工期紧张：预计需要 ${estimatedDays} 个工作日，调整后仅剩 ${workDaysAvailable} 个工作日`
      });
    }
    if (due < today) {
      errors.push({
        type: "past_due",
        message: "截止日期不能早于今天"
      });
    }
  }

  if (newOwner) {
    const ownerProjects = db.projects.filter(p =>
      p.owner === newOwner && p.status !== "已完成" && p.id !== project.id
    );
    const activeCount = ownerProjects.filter(p => p.status === "进行中").length;
    if (activeCount >= 3) {
      warnings.push({
        type: "worker_overload",
        message: `${newOwner} 已有 ${activeCount} 个进行中的项目，新增后可能超载`
      });
    }

    const pendingCount = ownerProjects.filter(p => p.status === "待复核").length;
    if (pendingCount > 0) {
      warnings.push({
        type: "worker_blocked",
        message: `${newOwner} 有 ${pendingCount} 个待复核项目，可能影响排程`
      });
    }
  }

  if (project.materials && project.materials.trim()) {
    const materialNames = project.materials.split(/[、,，\s]+/).filter(m => m.trim());
    for (const matName of materialNames) {
      const material = materials.find(m =>
        m.name.includes(matName) || matName.includes(m.name)
      );
      if (material && material.quantity <= material.lowStockThreshold) {
        warnings.push({
          type: "low_stock",
          message: `材料"${material.name}"库存不足（当前：${material.quantity}${material.unit}）`
        });
      }
    }
  }

  return { warnings, errors, isValid: errors.length === 0 };
}

export function calculateSchedule(db, viewerId, weeksCount = 6) {
  const today = new Date();
  const rangeStart = getWeekStart(today);
  const rangeEnd = addDays(rangeStart, weeksCount * 7 - 1);

  const viewers = db.users;
  const projects = db.projects;
  const templates = db.templates;
  const materials = db.materials;

  const viewer = db.users.find(u => u.id === viewerId);
  const isAdmin = viewer && viewer.role === "admin";

  let visibleWorkers = viewers;
  if (!isAdmin) {
    visibleWorkers = viewers.filter(u => u.id === viewerId);
  }

  const workerSchedules = {};
  for (const worker of visibleWorkers) {
    if (worker.role === "worker" || (isAdmin && worker.role === "worker")) {
      workerSchedules[worker.id] = generateWorkloadForWorker(
        worker.name,
        projects,
        templates,
        rangeStart,
        rangeEnd
      );
      workerSchedules[worker.id].workerId = worker.id;
      workerSchedules[worker.id].workerName = worker.name;
    }
  }

  const conflicts = detectConflicts(projects, templates, materials);

  const globalStats = {
    totalWorkers: Object.keys(workerSchedules).length,
    totalActiveProjects: projects.filter(p => p.status === "进行中").length,
    totalPendingReview: projects.filter(p => p.status === "待复核").length,
    totalOverdue: projects.filter(p => isOverdue(p)).length,
    conflicts
  };

  return {
    rangeStart: formatDate(rangeStart),
    rangeEnd: formatDate(rangeEnd),
    weeksCount,
    viewer: viewer ? { id: viewer.id, name: viewer.name, role: viewer.role } : null,
    isAdmin,
    workerSchedules,
    globalStats,
    conflicts
  };
}

export {
  formatDate,
  parseDate,
  addDays,
  isWeekend,
  getWorkDaysBetween,
  getNextWorkDay,
  addWorkDays,
  getWeekStart,
  getEstimatedDays,
  getProjectPriority,
  calculateProjectSchedule,
  generateWorkloadForWorker
};
