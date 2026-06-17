const viewer = document.querySelector("#viewer");
const weeksSelect = document.querySelector("#weeksSelect");
const refreshBtn = document.querySelector("#refreshBtn");
const conflictsBtn = document.querySelector("#conflictsBtn");
const conflictCount = document.querySelector("#conflictCount");
const conflictsPanel = document.querySelector("#conflictsPanel");
const conflictsList = document.querySelector("#conflictsList");
const closeConflicts = document.querySelector("#closeConflicts");
const scheduleContainer = document.querySelector("#scheduleContainer");

const adjustModal = document.querySelector("#adjustModal");
const closeAdjustModal = document.querySelector("#closeAdjustModal");
const cancelAdjust = document.querySelector("#cancelAdjust");
const confirmAdjust = document.querySelector("#confirmAdjust");
const adjustProjectInfo = document.querySelector("#adjustProjectInfo");
const adjustWarnings = document.querySelector("#adjustWarnings");
const adjustOwnerSelect = document.querySelector("#adjustOwnerSelect");
const adjustDueDate = document.querySelector("#adjustDueDate");

const confirmModal = document.querySelector("#confirmModal");
const closeConfirmModal = document.querySelector("#closeConfirmModal");
const cancelConfirm = document.querySelector("#cancelConfirm");
const forceAdjust = document.querySelector("#forceAdjust");
const confirmWarnings = document.querySelector("#confirmWarnings");

let users = [];
let scheduleData = null;
let currentAdjustProject = null;
let pendingAdjustData = null;
let draggedProject = null;

const weekDayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

async function api(path, options) {
  const headers = { "Content-Type": "application/json" };
  if (viewer && viewer.value) headers["X-Viewer-Id"] = viewer.value;
  if (options && options.method && options.method !== "GET") {
    const dv = window.DataVersionConflictHandler ? window.DataVersionConflictHandler.getVersion() : null;
    if (dv !== null) headers["X-Data-Version"] = String(dv);
  }
  const res = await fetch(path, options && options.body ? { ...options, headers } : (options ? { ...options, headers } : { headers }));
  if (window.DataVersionConflictHandler) window.DataVersionConflictHandler.extractVersionFromResponse(res);
  const data = await res.json();
  if (res.status === 409 && data.error === "data_version_conflict") {
    if (window.DataVersionConflictHandler) window.DataVersionConflictHandler.updateVersion(data.serverDataVersion);
    return { ...data, _dataVersionConflict: true };
  }
  return data;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusClass(s, isOverdue, isBlocked) {
  if (isBlocked) return 'blocked';
  if (isOverdue) return 'overdue';
  if (s === '待复核') return 'pending';
  if (s === '已完成') return 'done';
  return 'active';
}

function getSeverityClass(severity) {
  if (severity === 'danger') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function renderStats() {
  if (!scheduleData) return;
  const { globalStats, isAdmin } = scheduleData;

  let html = `
    <div class="stat"><span>修复人员</span><strong>${globalStats.totalWorkers}</strong></div>
    <div class="stat"><span>进行中项目</span><strong>${globalStats.totalActiveProjects}</strong></div>
    <div class="stat"><span>待复核项目</span><strong class="pending-text">${globalStats.totalPendingReview}</strong></div>
    <div class="stat"><span>逾期项目</span><strong class="danger-text">${globalStats.totalOverdue}</strong></div>
  `;

  if (isAdmin) {
    html += `
      <div class="stat"><span>冲突总数</span><strong class="${globalStats.conflicts.length > 0 ? 'danger-text' : ''}">${globalStats.conflicts.length}</strong></div>
    `;
  }

  document.querySelector("#scheduleStats").innerHTML = html;

  const dangerCount = globalStats.conflicts.filter(c => c.severity === 'danger').length;
  conflictCount.textContent = globalStats.conflicts.length;
  conflictCount.className = dangerCount > 0 ? 'danger-text' : '';
}

function renderConflicts() {
  if (!scheduleData) return;
  const { conflicts, isAdmin } = scheduleData;

  if (conflicts.length === 0) {
    conflictsList.innerHTML = '<div class="conflicts-empty">暂无冲突或风险</div>';
    return;
  }

  conflictsList.innerHTML = conflicts.map(c => `
    <div class="conflict-item conflict-${c.severity}">
      <div class="conflict-icon">${c.severity === 'danger' ? '⚠️' : c.severity === 'warning' ? '⚡' : 'ℹ️'}</div>
      <div class="conflict-body">
        <div class="conflict-type">${escapeHtml(c.type)} · ${escapeHtml(c.worker || c.projectTitle || '')}</div>
        <div class="conflict-message">${escapeHtml(c.message)}</div>
        ${c.projectId ? `<div class="conflict-project">项目：${escapeHtml(c.projectTitle || c.projectId)}</div>` : ''}
        ${c.materialName ? `<div class="conflict-material">材料：${escapeHtml(c.materialName)}（库存：${c.stock}${c.unit || ''}）</div>` : ''}
      </div>
    </div>
  `).join('');
}

function renderWorkerSchedule(workerId, schedule) {
  const { workerName, stats, weeks, assignments } = schedule;

  const avgLoad = stats.averageDailyLoad.toFixed(1);
  const maxLoad = stats.maxDailyLoad.toFixed(1);
  const loadStatus = maxLoad > 8 ? 'overload' : (maxLoad > 6 ? 'heavy' : 'normal');

  let html = `
    <div class="worker-schedule" data-worker-id="${escapeHtml(workerId)}">
      <div class="worker-header">
        <div class="worker-info">
          <h3>${escapeHtml(workerName)}</h3>
          <div class="worker-stats">
            <span class="worker-stat">进行中：<strong>${stats.activeProjects}</strong></span>
            <span class="worker-stat">待复核：<strong>${stats.blockedProjects}</strong></span>
            <span class="worker-stat">逾期：<strong class="danger-text">${stats.overdueProjects}</strong></span>
            <span class="worker-stat worker-load load-${loadStatus}">
              平均负载：<strong>${avgLoad}h/天</strong>（最高 ${maxLoad}h）
            </span>
          </div>
        </div>
        <div class="worker-actions">
          ${scheduleData.isAdmin ? `<button class="secondary assign-btn" data-worker="${escapeHtml(workerId)}">分配项目</button>` : ''}
        </div>
      </div>
  `;

  html += '<div class="worker-weeks">';
  for (const week of weeks) {
    html += renderWeek(week, workerId);
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function renderWeek(week, workerId) {
  const loadClass = week.isOverloaded ? 'week-overload' : (week.isHeavyLoad ? 'week-heavy' : '');
  const loadPercent = week.loadPercent.toFixed(0);

  let html = `
    <div class="schedule-week ${loadClass}">
      <div class="schedule-week-header">
        <div class="schedule-week-title">
          <h4>${escapeHtml(week.monthLabel)}</h4>
          <span class="schedule-week-range">${escapeHtml(week.weekLabel)}</span>
        </div>
        <div class="schedule-week-summary">
          <span class="week-hours">${week.totalHours.toFixed(0)}h / ${week.maxHours}h</span>
          <div class="week-load-bar">
            <div class="week-load-fill" style="width: ${Math.min(loadPercent, 100)}%"></div>
          </div>
          <span class="week-load-percent ${week.isOverloaded ? 'danger-text' : ''}">${loadPercent}%</span>
        </div>
      </div>
      <div class="schedule-week-grid">
  `;

  for (const day of week.days) {
    html += renderDay(day, workerId);
  }

  html += '</div></div>';
  return html;
}

function renderDay(day, workerId) {
  const dateParts = day.date.split('-');
  const dateDisplay = parseInt(dateParts[1], 10) + '/' + parseInt(dateParts[2], 10);
  const dayClasses = [
    'sched-day',
    day.isWeekend ? 'sched-day-weekend' : '',
    day.isToday ? 'sched-day-today' : '',
    day.isOverloaded ? 'sched-day-overload' : '',
    day.projects.length === 0 ? 'sched-day-empty' : ''
  ].join(' ');

  const dropTargetAttrs = scheduleData.isAdmin && !day.isWeekend
    ? `data-drop-target="true" data-date="${escapeHtml(day.date)}" data-worker="${escapeHtml(workerId)}"`
    : '';

  return `
    <div class="${dayClasses}" ${dropTargetAttrs}>
      <div class="sched-day-header">
        <span class="sched-day-weekday">${weekDayNames[day.dayOfWeek]}</span>
        <span class="sched-day-date">${dateDisplay}</span>
        ${!day.isWeekend ? `<span class="sched-day-hours ${day.isOverloaded ? 'danger-text' : ''}">${day.workload.toFixed(0)}h</span>` : ''}
      </div>
      <div class="sched-day-body">
        ${day.projects.map(p => renderProjectBar(p, day.date)).join('')}
        ${scheduleData.isAdmin && !day.isWeekend && day.projects.length === 0
          ? '<div class="sched-day-drop-hint">拖放项目至此</div>'
          : ''}
      </div>
    </div>
  `;
}

function renderProjectBar(project, dayDate) {
  const cls = statusClass(project.status, project.isOverdue, project.isBlocked);
  const isFirstDay = project.startDate === dayDate;
  const isLastDay = project.endDate === dayDate;

  let badges = '';
  if (project.isOverdue) badges += '<span class="sched-badge sched-badge-overdue">逾期</span>';
  if (project.isPendingReview) badges += '<span class="sched-badge sched-badge-review">待复核</span>';
  if (project.isBlocked) badges += '<span class="sched-badge sched-badge-blocked">阻塞</span>';

  const dragAttrs = scheduleData.isAdmin && !project.isBlocked
    ? `draggable="true" data-project-id="${escapeHtml(project.id)}" data-current-worker="${escapeHtml(project.owner)}"`
    : '';

  return `
    <div class="sched-project sched-project-${cls} ${isFirstDay ? 'first-day' : ''} ${isLastDay ? 'last-day' : ''}"
         ${dragAttrs}
         data-project-id="${escapeHtml(project.id)}">
      ${isFirstDay ? `
        <div class="sched-project-header">
          <span class="sched-project-title">${escapeHtml(project.title)}</span>
          <span class="sched-project-era">${escapeHtml(project.era)}</span>
        </div>
        <div class="sched-project-dates">${escapeHtml(project.startDate)} → ${escapeHtml(project.endDate)}</div>
        <div class="sched-project-badges">${badges}</div>
      ` : `
        <div class="sched-project-continued">
          <span class="sched-project-title-mini">${escapeHtml(project.title)}</span>
        </div>
      `}
    </div>
  `;
}

function render() {
  if (!scheduleData) return;
  renderStats();
  renderConflicts();

  const { workerSchedules, isAdmin } = scheduleData;
  const workerIds = Object.keys(workerSchedules);

  if (workerIds.length === 0) {
    scheduleContainer.innerHTML = '<div class="schedule-empty">暂无排程数据</div>';
    return;
  }

  scheduleContainer.innerHTML = workerIds.map(id => renderWorkerSchedule(id, workerSchedules[id])).join('');
  bindDragAndDrop();
  bindProjectClicks();
}

function bindDragAndDrop() {
  if (!scheduleData.isAdmin) return;

  const projectBars = document.querySelectorAll('.sched-project[draggable="true"]');
  projectBars.forEach(bar => {
    bar.addEventListener('dragstart', (e) => {
      draggedProject = {
        id: bar.dataset.projectId,
        currentWorker: bar.dataset.currentWorker
      };
      bar.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', bar.dataset.projectId);
    });

    bar.addEventListener('dragend', () => {
      bar.classList.remove('dragging');
      draggedProject = null;
      document.querySelectorAll('.sched-day').forEach(d => d.classList.remove('drag-over'));
    });
  });

  const dropTargets = document.querySelectorAll('.sched-day[data-drop-target="true"]');
  dropTargets.forEach(day => {
    day.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      day.classList.add('drag-over');
    });

    day.addEventListener('dragleave', () => {
      day.classList.remove('drag-over');
    });

    day.addEventListener('drop', (e) => {
      e.preventDefault();
      day.classList.remove('drag-over');

      if (!draggedProject) return;

      const targetDate = day.dataset.date;
      const targetWorkerId = day.dataset.worker;
      const targetWorker = users.find(u => u.id === targetWorkerId);

      openAdjustModal(draggedProject.id, {
        newOwnerId: targetWorkerId,
        newDueDate: calculateDueDate(targetDate, draggedProject.id)
      });
    });
  });
}

function calculateDueDate(startDate, projectId) {
  if (!scheduleData) return startDate;

  for (const schedule of Object.values(scheduleData.workerSchedules)) {
    const assignment = schedule.assignments.find(a => a.projectId === projectId);
    if (assignment) {
      const start = new Date(startDate + 'T00:00:00');
      const workDays = assignment.workDays;
      let added = 0;
      let d = new Date(start);
      while (added < workDays - 1) {
        d.setDate(d.getDate() + 1);
        const dayOfWeek = d.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) added++;
      }
      return d.toISOString().slice(0, 10);
    }
  }
  return startDate;
}

function bindProjectClicks() {
  document.querySelectorAll('.sched-project').forEach(bar => {
    bar.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (scheduleData.isAdmin && !e.target.closest('.sched-project').classList.contains('dragging')) {
        const projectId = bar.dataset.projectId;
        openAdjustModal(projectId, {});
      } else {
        window.location.href = '/?highlight=' + encodeURIComponent(bar.dataset.projectId);
      }
    });
  });
}

function openAdjustModal(projectId, initialValues = {}) {
  const project = findProject(projectId);
  if (!project) return;

  currentAdjustProject = project;

  adjustProjectInfo.innerHTML = `
    <div class="adjust-info-row">
      <span class="adjust-label">项目：</span>
      <span class="adjust-value"><strong>${escapeHtml(project.title)}</strong></span>
    </div>
    <div class="adjust-info-row">
      <span class="adjust-label">年代：</span>
      <span class="adjust-value">${escapeHtml(project.era)}</span>
    </div>
    <div class="adjust-info-row">
      <span class="adjust-label">当前负责人：</span>
      <span class="adjust-value">${escapeHtml(project.owner)}</span>
    </div>
    <div class="adjust-info-row">
      <span class="adjust-label">当前截止日期：</span>
      <span class="adjust-value">${escapeHtml(project.dueDate)}</span>
    </div>
    <div class="adjust-info-row">
      <span class="adjust-label">状态：</span>
      <span class="adjust-value">${escapeHtml(project.status)}</span>
    </div>
    ${project.estimatedDays ? `
      <div class="adjust-info-row">
        <span class="adjust-label">预计工期：</span>
        <span class="adjust-value">${project.estimatedDays} 个工作日</span>
      </div>
    ` : ''}
  `;

  const workerOptions = users
    .filter(u => u.role === 'worker')
    .map(u => `<option value="${escapeHtml(u.id)}" ${u.name === project.owner ? 'selected' : ''}>${escapeHtml(u.name)}</option>`)
    .join('');
  adjustOwnerSelect.innerHTML = workerOptions;

  adjustDueDate.value = initialValues.newDueDate || project.dueDate;
  if (initialValues.newOwnerId) {
    adjustOwnerSelect.value = initialValues.newOwnerId;
  }

  adjustWarnings.innerHTML = '';
  pendingAdjustData = null;

  adjustModal.style.display = 'flex';

  setTimeout(() => validateAdjustment(), 100);
}

async function validateAdjustment() {
  if (!currentAdjustProject) return;

  const newOwnerId = adjustOwnerSelect.value;
  const newDueDate = adjustDueDate.value;

  const result = await api('/api/schedule/validate', {
    method: 'POST',
    body: JSON.stringify({
      projectId: currentAdjustProject.id,
      newOwnerId,
      newDueDate
    })
  });

  if (result.error) {
    adjustWarnings.innerHTML = `<div class="adjust-error">${escapeHtml(result.message)}</div>`;
    return;
  }

  pendingAdjustData = { newOwnerId, newDueDate, validation: result.validation };

  let warningsHtml = '';

  if (result.validation.errors.length > 0) {
    warningsHtml += '<div class="adjust-errors">';
    warningsHtml += '<div class="adjust-warnings-title">错误：</div>';
    warningsHtml += result.validation.errors.map(e => `
      <div class="adjust-warning-item error">
        <span class="warning-icon">❌</span>
        <span>${escapeHtml(e.message)}</span>
      </div>
    `).join('');
    warningsHtml += '</div>';
  }

  if (result.validation.warnings.length > 0) {
    warningsHtml += '<div class="adjust-warnings-list">';
    warningsHtml += '<div class="adjust-warnings-title">风险警告：</div>';
    warningsHtml += result.validation.warnings.map(w => `
      <div class="adjust-warning-item warning">
        <span class="warning-icon">⚠️</span>
        <span>${escapeHtml(w.message)}</span>
      </div>
    `).join('');
    warningsHtml += '</div>';
  }

  if (result.conflicts && result.conflicts.length > 0) {
    warningsHtml += '<div class="adjust-conflicts">';
    warningsHtml += '<div class="adjust-warnings-title">相关冲突：</div>';
    warningsHtml += result.conflicts.slice(0, 5).map(c => `
      <div class="adjust-warning-item ${c.severity}">
        <span class="warning-icon">${c.severity === 'danger' ? '⚠️' : '⚡'}</span>
        <span>${escapeHtml(c.message)}</span>
      </div>
    `).join('');
    if (result.conflicts.length > 5) {
      warningsHtml += `<div class="adjust-more-conflicts">还有 ${result.conflicts.length - 5} 个冲突...</div>`;
    }
    warningsHtml += '</div>';
  }

  if (!warningsHtml) {
    warningsHtml = '<div class="adjust-no-warnings">✓ 未检测到风险，可安全调整</div>';
  }

  adjustWarnings.innerHTML = warningsHtml;
  confirmAdjust.disabled = result.validation.errors.length > 0;
}

async function submitAdjustment(force = false) {
  if (!pendingAdjustData) return;

  const result = await api('/api/schedule/adjust', {
    method: 'POST',
    body: JSON.stringify({
      projectId: currentAdjustProject.id,
      newOwnerId: pendingAdjustData.newOwnerId,
      newDueDate: pendingAdjustData.newDueDate,
      force
    })
  });

  if (result.error === 'validation_failed') {
    adjustWarnings.innerHTML = `<div class="adjust-error">${escapeHtml(result.message)}</div>`;
    return;
  }

  if (result.warning === 'has_warnings') {
    openConfirmModal(result.warnings);
    return;
  }

  if (result.success) {
    adjustModal.style.display = 'none';
    confirmModal.style.display = 'none';
    showNotification('排程调整已保存', 'success');
    scheduleData = result.updatedSchedule;
    render();
  }
}

function openConfirmModal(warnings) {
  confirmWarnings.innerHTML = warnings.map(w => `
    <div class="confirm-warning-item ${w.type}">
      <span class="warning-icon">⚠️</span>
      <span>${escapeHtml(w.message)}</span>
    </div>
  `).join('');
  confirmModal.style.display = 'flex';
}

function findProject(projectId) {
  for (const schedule of Object.values(scheduleData.workerSchedules)) {
    const assignment = schedule.assignments.find(a => a.projectId === projectId);
    if (assignment) {
      return {
        ...assignment.project,
        estimatedDays: assignment.estimatedDays
      };
    }
  }
  return null;
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

async function loadSchedule() {
  const weeks = weeksSelect.value;
  scheduleData = await api('/api/schedule?weeks=' + weeks);
  if (scheduleData.error) {
    scheduleContainer.innerHTML = `<div class="schedule-error">${escapeHtml(scheduleData.message || '加载失败')}</div>`;
    return;
  }
  render();
}

async function loadUsers() {
  users = await api('/api/users');
  viewer.innerHTML = users.map((u) => '<option value="' + u.id + '">' + escapeHtml(u.name) + ' · ' + escapeHtml(u.role) + '</option>').join("");
  if (!viewer.value) viewer.value = users[0].id;
}

viewer.onchange = () => loadSchedule();
weeksSelect.onchange = () => loadSchedule();
refreshBtn.onclick = () => loadSchedule();

conflictsBtn.onclick = () => {
  conflictsPanel.style.display = conflictsPanel.style.display === 'none' ? 'block' : 'none';
};

closeConflicts.onclick = () => {
  conflictsPanel.style.display = 'none';
};

closeAdjustModal.onclick = () => { adjustModal.style.display = 'none'; currentAdjustProject = null; };
cancelAdjust.onclick = () => { adjustModal.style.display = 'none'; currentAdjustProject = null; };

adjustOwnerSelect.onchange = () => validateAdjustment();
adjustDueDate.onchange = () => validateAdjustment();

confirmAdjust.onclick = () => submitAdjustment(false);

closeConfirmModal.onclick = () => { confirmModal.style.display = 'none'; };
cancelConfirm.onclick = () => { confirmModal.style.display = 'none'; };
forceAdjust.onclick = () => submitAdjustment(true);

(async function init() {
  await loadUsers();
  await loadSchedule();
})();
