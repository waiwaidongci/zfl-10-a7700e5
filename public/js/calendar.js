const viewer = document.querySelector("#viewer");
const weeksSelect = document.querySelector("#weeksSelect");
const todayBtn = document.querySelector("#todayBtn");
const calendarStats = document.querySelector("#calendarStats");
const calendarWeeks = document.querySelector("#calendarWeeks");

const weekDayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

let users = [];
let calendarData = null;

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

function statusClass(s, isOverdue) {
  if (isOverdue) return 'overdue';
  if (s === '待复核') return 'pending';
  if (s === '已完成') return 'done';
  return 'active';
}

function renderStats() {
  if (!calendarData) return;
  const { stats, viewer: v } = calendarData;
  calendarStats.innerHTML =
    '<div class="stat"><span>可见项目</span><strong>' + stats.total + '</strong></div>' +
    '<div class="stat"><span>进行中</span><strong>' + stats.active + '</strong></div>' +
    '<div class="stat"><span>逾期</span><strong class="danger-text">' + stats.overdue + '</strong></div>' +
    '<div class="stat"><span>待复核</span><strong class="pending-text">' + stats.pendingReview + '</strong></div>';
}

function renderProjectCard(p) {
  const cls = statusClass(p.status, p.isOverdue);
  const overdueBadge = p.isOverdue ? '<span class="cal-badge overdue-badge">逾期</span>' : '';
  const reviewBadge = p.isPendingReview ? '<span class="cal-badge review-badge">待复核</span>' : '';

  return (
    '<div class="cal-project cal-project-' + cls + '" data-project-id="' + escapeHtml(p.id) + '">' +
      '<div class="cal-project-title">' + escapeHtml(p.title) + '</div>' +
      '<div class="cal-project-meta">' +
        '<span class="cal-project-owner">' + escapeHtml(p.owner) + '</span>' +
        '<span class="cal-project-era">' + escapeHtml(p.era) + '</span>' +
      '</div>' +
      '<div class="cal-project-badges">' + overdueBadge + reviewBadge + '</div>' +
    '</div>'
  );
}

function renderDay(day) {
  const dateParts = day.date.split('-');
  const dateDisplay = parseInt(dateParts[1], 10) + '/' + parseInt(dateParts[2], 10);
  const dayClasses = [
    'cal-day',
    day.isWeekend ? 'cal-day-weekend' : '',
    day.isToday ? 'cal-day-today' : '',
    day.projects.length === 0 ? 'cal-day-empty' : ''
  ].join(' ');

  return (
    '<div class="' + dayClasses + '">' +
      '<div class="cal-day-header">' +
        '<span class="cal-day-weekday">' + weekDayNames[day.dayOfWeek] + '</span>' +
        '<span class="cal-day-date">' + dateDisplay + '</span>' +
      '</div>' +
      '<div class="cal-day-body">' +
        day.projects.map(renderProjectCard).join('') +
      '</div>' +
    '</div>'
  );
}

function renderWeek(week) {
  const summaryBadges = [];
  if (week.overdueCount > 0) {
    summaryBadges.push('<span class="week-summary-badge week-overdue">逾期 ' + week.overdueCount + '</span>');
  }
  if (week.pendingReviewCount > 0) {
    summaryBadges.push('<span class="week-summary-badge week-pending">待复核 ' + week.pendingReviewCount + '</span>');
  }

  return (
    '<div class="cal-week">' +
      '<div class="cal-week-header">' +
        '<div class="cal-week-title">' +
          '<h3>' + escapeHtml(week.monthLabel) + '</h3>' +
          '<span class="cal-week-range">' + escapeHtml(week.weekLabel) + '</span>' +
        '</div>' +
        '<div class="cal-week-summary">' +
          '<span class="week-project-count">共 ' + week.projectCount + ' 项</span>' +
          summaryBadges.join('') +
        '</div>' +
      '</div>' +
      '<div class="cal-week-grid">' +
        week.days.map(renderDay).join('') +
      '</div>' +
    '</div>'
  );
}

function render() {
  if (!calendarData) return;
  renderStats();
  calendarWeeks.innerHTML = calendarData.weeks.map(renderWeek).join('');
  bindProjectClicks();
}

function bindProjectClicks() {
  document.querySelectorAll('.cal-project').forEach((card) => {
    card.onclick = () => {
      window.location.href = '/?highlight=' + encodeURIComponent(card.dataset.projectId);
    };
  });
}

async function loadCalendar() {
  const weeks = weeksSelect.value;
  calendarData = await api('/api/calendar?weeks=' + weeks);
  render();
}

async function loadUsers() {
  users = await api('/api/users');
  viewer.innerHTML = users.map((u) => '<option value="' + u.id + '">' + escapeHtml(u.name) + ' · ' + escapeHtml(u.role) + '</option>').join("");
  if (!viewer.value) viewer.value = users[0].id;
}

viewer.onchange = () => loadCalendar();
weeksSelect.onchange = () => loadCalendar();
todayBtn.onclick = () => loadCalendar();

(async function init() {
  await loadUsers();
  await loadCalendar();
})();
