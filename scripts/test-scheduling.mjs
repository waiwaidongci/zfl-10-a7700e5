import test from "node:test";
import assert from "node:assert/strict";
import {
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
  generateWorkloadForWorker,
  calculateSchedule
} from "../src/utils/scheduling.js";

function makeDb(overrides = {}) {
  return {
    users: [
      { id: "u-admin", name: "管理员", role: "admin" },
      { id: "u-mei", name: "顾眉", role: "worker" },
      { id: "u-yan", name: "严澈", role: "worker" }
    ],
    projects: overrides.projects || [],
    templates: overrides.templates || [],
    materials: overrides.materials || [],
    intakes: overrides.intakes || [],
    timelineRecords: overrides.timelineRecords || [],
    reviewRecords: overrides.reviewRecords || [],
    auditLogs: overrides.auditLogs || [],
    photoArchive: overrides.photoArchive || {},
    dataVersion: 1
  };
}

test("scheduling 纯函数测试 | formatDate 将日期格式化为 YYYY-MM-DD", () => {
  const d = new Date(2026, 5, 17);
  assert.equal(formatDate(d), "2026-06-17");
});

test("scheduling 纯函数测试 | parseDate 将字符串解析为日期（当天零点）", () => {
  const d = parseDate("2026-06-17");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5);
  assert.equal(d.getDate(), 17);
  assert.equal(d.getHours(), 0);
});

test("scheduling 纯函数测试 | addDays 增加指定天数", () => {
  const base = new Date(2026, 5, 17);
  const r = addDays(base, 5);
  assert.equal(r.getDate(), 22);
});

test("scheduling 纯函数测试 | isWeekend 正确识别周六周日", () => {
  const saturday = new Date(2026, 5, 20);
  const sunday = new Date(2026, 5, 21);
  const monday = new Date(2026, 5, 22);
  assert.equal(saturday.getDay(), 6);
  assert.equal(isWeekend(saturday), true);
  assert.equal(isWeekend(sunday), true);
  assert.equal(isWeekend(monday), false);
});

test("scheduling 纯函数测试 | getWeekStart 返回周一周一", () => {
  const wednesday = new Date(2026, 5, 17);
  const weekStart = getWeekStart(wednesday);
  assert.equal(weekStart.getDay(), 1);
  assert.equal(weekStart.getDate(), 15);
});

test("工作日跳过周末 | getNextWorkDay 周五本身是工作日，直接返回周五", () => {
  const friday = new Date(2026, 5, 19);
  assert.equal(friday.getDay(), 5);
  const nextWork = getNextWorkDay(friday);
  assert.equal(nextWork.getDay(), 5);
  assert.equal(nextWork.getDate(), 19);
});

test("工作日跳过周末 | getNextWorkDay 周日跳到下周一", () => {
  const sunday = new Date(2026, 5, 21);
  assert.equal(sunday.getDay(), 0);
  const nextWork = getNextWorkDay(sunday);
  assert.equal(nextWork.getDay(), 1);
  assert.equal(nextWork.getDate(), 22);
});

test("工作日跳过周末 | getNextWorkDay 周六直接跳到下周一", () => {
  const saturday = new Date(2026, 5, 20);
  const nextWork = getNextWorkDay(saturday);
  assert.equal(nextWork.getDay(), 1);
  assert.equal(nextWork.getDate(), 22);
});

test("工作日跳过周末 | addWorkDays 周五加1个工作日到下周一", () => {
  const friday = new Date(2026, 5, 19);
  const result = addWorkDays(friday, 1);
  assert.equal(result.getDay(), 1);
  assert.equal(result.getDate(), 22);
});

test("工作日跳过周末 | addWorkDays 正确跨过多个周末", () => {
  const monday = new Date(2026, 5, 15);
  assert.equal(monday.getDay(), 1);
  const result = addWorkDays(monday, 7);
  assert.equal(result.getDay(), 3);
  assert.equal(result.getDate(), 24);
});

test("工作日跳过周末 | getWorkDaysBetween 只计算工作日", () => {
  const mon = new Date(2026, 5, 15);
  const nextFri = new Date(2026, 5, 26);
  const days = getWorkDaysBetween(mon, nextFri);
  assert.equal(days, 10);
});

test("工作日跳过周末 | calculateProjectSchedule 开始日遇到周末自动跳到周一", () => {
  const project = { id: "P1", templateId: "T1" };
  const templates = [{ id: "T1", estimatedDays: 2 }];
  const saturday = new Date(2026, 5, 20);
  const result = calculateProjectSchedule(project, templates, saturday);
  assert.equal(result.startDate, "2026-06-22");
  assert.equal(result.endDate, "2026-06-23");
});

test("工作日跳过周末 | calculateProjectSchedule 工期跨周末时自动跳过", () => {
  const project = { id: "P1", templateId: "T1" };
  const templates = [{ id: "T1", estimatedDays: 5 }];
  const thursday = new Date(2026, 5, 18);
  const result = calculateProjectSchedule(project, templates, thursday);
  assert.equal(result.startDate, "2026-06-18");
  assert.equal(result.endDate, "2026-06-24");
});

test("待复核项目阻塞 | generateWorkloadForWorker 待复核项目标记为 isBlocked", () => {
  const projects = [
    {
      id: "P1",
      title: "待复核项目",
      status: "待复核",
      owner: "顾眉",
      dueDate: "2026-07-01"
    }
  ];
  const templates = [];
  const rangeStart = new Date(2026, 5, 15);
  const rangeEnd = new Date(2026, 5, 28);
  const result = generateWorkloadForWorker("顾眉", projects, templates, rangeStart, rangeEnd);
  const blocked = result.assignments.find(a => a.projectId === "P1");
  assert.equal(blocked.isBlocked, true);
  assert.equal(blocked.blockReason, "待复核");
});

test("待复核项目阻塞 | 待复核项目不推进 scheduleCursor，后续项目因与阻塞日冲突顺延", () => {
  const projects = [
    {
      id: "P-BLOCK",
      title: "待复核阻塞项",
      status: "待复核",
      owner: "顾眉",
      dueDate: "2026-07-01"
    },
    {
      id: "P-NEXT",
      title: "后续项目",
      status: "进行中",
      owner: "顾眉",
      dueDate: "2026-07-01",
      templateId: "T1"
    }
  ];
  const templates = [{ id: "T1", estimatedDays: 2 }];
  const rangeStart = new Date(2026, 5, 15);
  const rangeEnd = new Date(2026, 5, 28);
  const result = generateWorkloadForWorker("顾眉", projects, templates, rangeStart, rangeEnd);
  const blocked = result.assignments.find(a => a.projectId === "P-BLOCK");
  const next = result.assignments.find(a => a.projectId === "P-NEXT");
  assert.equal(blocked.isBlocked, true);
  assert.equal(blocked.blockReason, "待复核");
  assert.equal(blocked.startDate, "2026-06-15");
  assert.equal(blocked.endDate, "2026-06-15");
  assert.equal(next.startDate, "2026-06-16");
  assert.equal(next.endDate, "2026-06-17");
  assert.equal(next.isBlocked, false);
});

test("待复核项目阻塞 | 多个待复核项目全部阻塞，不互相抢占时间", () => {
  const projects = [
    { id: "B1", title: "阻塞1", status: "待复核", owner: "顾眉", dueDate: "2026-07-01" },
    { id: "B2", title: "阻塞2", status: "待复核", owner: "顾眉", dueDate: "2026-07-01" },
    { id: "B3", title: "阻塞3", status: "待复核", owner: "顾眉", dueDate: "2026-07-01" }
  ];
  const templates = [];
  const rangeStart = new Date(2026, 5, 15);
  const rangeEnd = new Date(2026, 5, 28);
  const result = generateWorkloadForWorker("顾眉", projects, templates, rangeStart, rangeEnd);
  assert.equal(result.stats.blockedProjects, 3);
  for (const a of result.assignments) {
    assert.equal(a.isBlocked, true);
    assert.equal(a.blockReason, "待复核");
  }
});

test("模板estimatedDays | getEstimatedDays 优先使用 templateSnapshot.estimatedDays", () => {
  const project = {
    templateId: "T-OLD",
    templateSnapshot: { estimatedDays: 10, templateName: "自定义" }
  };
  const templates = [{ id: "T-OLD", estimatedDays: 3 }];
  assert.equal(getEstimatedDays(project, templates), 10);
});

test("模板estimatedDays | getEstimatedDays 快照为空时回退到 templateId 查询", () => {
  const project = { templateId: "T1" };
  const templates = [{ id: "T1", estimatedDays: 7 }];
  assert.equal(getEstimatedDays(project, templates), 7);
});

test("模板estimatedDays | getEstimatedDays 无模板信息时使用默认值 5", () => {
  const project = {};
  const templates = [];
  assert.equal(getEstimatedDays(project, templates), 5);
});

test("模板estimatedDays | 工期长的模板对应更晚的结束日期", () => {
  const projectShort = { id: "PS", templateId: "T-SHORT" };
  const projectLong = { id: "PL", templateId: "T-LONG" };
  const templates = [
    { id: "T-SHORT", estimatedDays: 1 },
    { id: "T-LONG", estimatedDays: 10 }
  ];
  const start = new Date(2026, 5, 15);
  const shortResult = calculateProjectSchedule(projectShort, templates, start);
  const longResult = calculateProjectSchedule(projectLong, templates, start);
  assert.equal(shortResult.estimatedDays, 1);
  assert.equal(longResult.estimatedDays, 10);
  assert.equal(shortResult.startDate, longResult.startDate);
  assert.ok(parseDate(longResult.endDate) > parseDate(shortResult.endDate));
});

test("模板estimatedDays | templateSnapshot.estimatedDays 改变起止日期", () => {
  const projectSnapshot = {
    id: "P-SNAP",
    templateId: "T1",
    templateSnapshot: { estimatedDays: 15 }
  };
  const projectNoSnapshot = {
    id: "P-NOSNAP",
    templateId: "T1"
  };
  const templates = [{ id: "T1", estimatedDays: 5 }];
  const start = new Date(2026, 5, 15);
  const snapResult = calculateProjectSchedule(projectSnapshot, templates, start);
  const noSnapResult = calculateProjectSchedule(projectNoSnapshot, templates, start);
  assert.equal(snapResult.estimatedDays, 15);
  assert.equal(noSnapResult.estimatedDays, 5);
  const snapEnd = parseDate(snapResult.endDate);
  const noSnapEnd = parseDate(noSnapResult.endDate);
  const diffDays = (snapEnd - noSnapEnd) / (1000 * 60 * 60 * 24);
  assert.ok(diffDays > 7);
});

test("普通修复人员权限 | calculateSchedule 普通修复人员只看到自己的 workerSchedule", () => {
  const projects = [
    { id: "P-MEI", title: "顾眉的项目", status: "进行中", owner: "顾眉", dueDate: "2026-07-01" },
    { id: "P-YAN", title: "严澈的项目", status: "进行中", owner: "严澈", dueDate: "2026-07-01" }
  ];
  const db = makeDb({ projects });
  const result = calculateSchedule(db, "u-mei", 2);
  assert.equal(result.viewer.role, "worker");
  assert.equal(result.isAdmin, false);
  assert.ok(result.workerSchedules["u-mei"]);
  assert.equal(result.workerSchedules["u-mei"].workerName, "顾眉");
  assert.equal(result.workerSchedules["u-yan"], undefined);
});

test("普通修复人员权限 | calculateSchedule 普通修复人员看不到他人项目的 assignments", () => {
  const projects = [
    { id: "P-MEI", title: "顾眉的项目", status: "进行中", owner: "顾眉", dueDate: "2026-07-01" },
    { id: "P-YAN", title: "严澈的项目", status: "进行中", owner: "严澈", dueDate: "2026-07-01" }
  ];
  const db = makeDb({ projects });
  const result = calculateSchedule(db, "u-yan", 2);
  const yanSchedule = result.workerSchedules["u-yan"];
  const assignedIds = yanSchedule.assignments.map(a => a.projectId);
  assert.ok(assignedIds.includes("P-YAN"));
  assert.equal(assignedIds.includes("P-MEI"), false);
});

test("普通修复人员权限 | calculateSchedule 管理员可看到全部修复人员排程", () => {
  const projects = [
    { id: "P-MEI", title: "顾眉的项目", status: "进行中", owner: "顾眉", dueDate: "2026-07-01" },
    { id: "P-YAN", title: "严澈的项目", status: "进行中", owner: "严澈", dueDate: "2026-07-01" }
  ];
  const db = makeDb({ projects });
  const result = calculateSchedule(db, "u-admin", 2);
  assert.equal(result.isAdmin, true);
  assert.equal(result.globalStats.totalWorkers, 2);
  assert.ok(result.workerSchedules["u-mei"]);
  assert.ok(result.workerSchedules["u-yan"]);
});

test("普通修复人员权限 | 冲突信息也按可见人员过滤", () => {
  const projects = [
    { id: "P-MEI", title: "顾眉的项目", status: "进行中", owner: "顾眉", dueDate: "2026-06-01" },
    { id: "P-YAN", title: "严澈的项目", status: "进行中", owner: "严澈", dueDate: "2026-06-01" }
  ];
  const db = makeDb({ projects });
  const meiResult = calculateSchedule(db, "u-mei", 2);
  const adminResult = calculateSchedule(db, "u-admin", 2);
  assert.ok(adminResult.conflicts.length >= meiResult.conflicts.length);
  const meiWorkers = meiResult.conflicts.filter(c => c.worker).map(c => c.worker);
  for (const w of meiWorkers) {
    assert.equal(w, "顾眉");
  }
});

test("getProjectPriority | 已完成项目优先级最低", () => {
  const done = { id: "D", status: "已完成", dueDate: "2026-01-01" };
  const active = { id: "A", status: "进行中", dueDate: "2099-01-01" };
  assert.ok(getProjectPriority(done) < getProjectPriority(active));
});

test("getProjectPriority | 待复核项目加分", () => {
  const pending = { id: "P", status: "待复核", dueDate: "2099-01-01" };
  const active = { id: "A", status: "进行中", dueDate: "2099-01-01" };
  assert.ok(getProjectPriority(pending) > getProjectPriority(active));
});

test("calculateProjectSchedule | 现有排程冲突时自动顺延", () => {
  const project = { id: "P1", templateId: "T1" };
  const templates = [{ id: "T1", estimatedDays: 2 }];
  const start = new Date(2026, 5, 15);
  const existing = [
    { startDate: "2026-06-15", endDate: "2026-06-16" }
  ];
  const result = calculateProjectSchedule(project, templates, start, existing);
  assert.equal(result.startDate, "2026-06-17");
  assert.equal(result.endDate, "2026-06-18");
});

test("generateWorkloadForWorker | 多个项目按优先级排序，不重叠", () => {
  const projects = [
    { id: "P1", title: "低优", status: "进行中", owner: "顾眉", dueDate: "2099-01-01", templateId: "T1" },
    { id: "P2", title: "逾期高优", status: "进行中", owner: "顾眉", dueDate: "2026-01-01", templateId: "T1" }
  ];
  const templates = [{ id: "T1", estimatedDays: 2 }];
  const rangeStart = new Date(2026, 5, 15);
  const rangeEnd = new Date(2026, 5, 30);
  const result = generateWorkloadForWorker("顾眉", projects, templates, rangeStart, rangeEnd);
  const first = result.assignments[0];
  const second = result.assignments[1];
  assert.equal(first.projectId, "P2");
  assert.equal(second.projectId, "P1");
  assert.ok(parseDate(second.startDate) > parseDate(first.endDate));
});

test("generateWorkloadForWorker | 周视图数据不包含周末项目", () => {
  const projects = [
    { id: "P1", title: "项目1", status: "进行中", owner: "顾眉", dueDate: "2099-01-01", templateId: "T-LONG" }
  ];
  const templates = [{ id: "T-LONG", estimatedDays: 10 }];
  const rangeStart = new Date(2026, 5, 15);
  const rangeEnd = new Date(2026, 5, 30);
  const result = generateWorkloadForWorker("顾眉", projects, templates, rangeStart, rangeEnd);
  for (const week of result.weeks) {
    for (const day of week.days) {
      if (day.isWeekend) {
        assert.equal(day.projects.length, 0);
      }
    }
  }
});

test("getWorkDaysBetween | 同一天返回1", () => {
  const d = new Date(2026, 5, 17);
  assert.equal(getWorkDaysBetween(d, d), 1);
});

test("getWorkDaysBetween | 周末区间返回0", () => {
  const sat = new Date(2026, 5, 20);
  const sun = new Date(2026, 5, 21);
  assert.equal(getWorkDaysBetween(sat, sun), 0);
});
