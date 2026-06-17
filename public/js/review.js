const viewer = document.querySelector("#viewer");
const reviewStats = document.querySelector("#reviewStats");
const reviewList = document.querySelector("#reviewList");
const noPermission = document.querySelector("#noPermission");
const emptyState = document.querySelector("#emptyState");
const reviewModal = document.querySelector("#reviewModal");
const modalTitle = document.querySelector("#modalTitle");
const projectInfo = document.querySelector("#projectInfo");
const reviewOpinion = document.querySelector("#reviewOpinion");
const modalClose = document.querySelector("#modalClose");
const approveBtn = document.querySelector("#approveBtn");
const rejectBtn = document.querySelector("#rejectBtn");

let users = [];
let currentUser = null;
let pendingProjects = [];
let selectedProject = null;

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, options) {
  const headers = { "Content-Type": "application/json" };
  if (currentUser) {
    headers["X-Viewer-Id"] = currentUser.id;
  }
  if (options && options.method && options.method !== "GET") {
    const dv = window.DataVersionConflictHandler ? window.DataVersionConflictHandler.getVersion() : null;
    if (dv !== null) headers["X-Data-Version"] = String(dv);
  }
  const res = await fetch(path, {
    ...options,
    headers: options && options.body ? { ...headers, ...options.headers } : headers
  });
  if (window.DataVersionConflictHandler) window.DataVersionConflictHandler.extractVersionFromResponse(res);
  const data = await res.json();
  if (res.status === 409 && data.error === "data_version_conflict") {
    if (window.DataVersionConflictHandler) window.DataVersionConflictHandler.updateVersion(data.serverDataVersion);
    return { ...data, _dataVersionConflict: true };
  }
  return data;
}

function handleDataVersionConflict(errorData, options) {
  if (!window.DataVersionConflictHandler) {
    alert("数据已被其他操作修改，请刷新页面后重试。");
    location.reload();
    return;
  }
  window.DataVersionConflictHandler.handleConflict(errorData, {
    pageLabel: options && options.pageLabel ? options.pageLabel : "复核",
    onReload: function() { location.reload(); },
    onSaveDraft: function(data) {
      return window.DataVersionConflictHandler.saveDraftToLocalStorage("review_" + Date.now(), data, "复核");
    },
    onRetry: options && options.onRetry ? options.onRetry : function() { load(); }
  });
}

function renderStats() {
  const overdueCount = pendingProjects.filter((p) => p.overdue).length;
  const rejectedCount = pendingProjects.filter((p) => p.lastRejection).length;
  const totalPhotos = pendingProjects.reduce((sum, p) => sum + (p.photoCount || 0), 0);
  const workload = pendingProjects.reduce((map, item) => {
    map[item.owner] = (map[item.owner] || 0) + 1;
    return map;
  }, {});

  reviewStats.innerHTML =
    '<div class="stat"><span>待复核</span><strong>' + pendingProjects.length + '</strong></div>' +
    '<div class="stat"><span>已逾期</span><strong>' + overdueCount + '</strong></div>' +
    '<div class="stat"><span>曾退回</span><strong>' + rejectedCount + '</strong></div>' +
    '<div class="stat"><span>照片总计</span><strong>' + totalPhotos + '</strong></div>' +
    '<div class="stat"><span>负责人分布</span><strong>' +
    (Object.keys(workload).length > 0
      ? Object.entries(workload).map(([k, v]) => k + v).join(" / ")
      : "-") +
    '</strong></div>';
}

function renderHistory(records) {
  if (!records || records.length === 0) return "";
  return '<div class="review-history">' +
    '<div class="history-title">复核历史</div>' +
    records.map((r) => (
      '<div class="history-item">' +
        '<div class="history-row">' +
          '<span class="history-reviewer">' + escapeHtml(r.reviewer) + '</span>' +
          '<span class="pill ' + (r.result === "通过" ? "done" : "active") + '">' + escapeHtml(r.result) + '</span>' +
          '<span class="history-date">' + escapeHtml(r.reviewedAt) + '</span>' +
        '</div>' +
        '<div class="history-opinion"><b>意见：</b>' + escapeHtml(r.opinion) + '</div>' +
      '</div>'
    )).join("") +
    '</div>';
}

function renderEnrichment(p) {
  let html = '<div class="review-enrichment">';

  if (p.reviewRequirements) {
    html += '<div class="enrichment-item requirement">' +
      '<div class="enrichment-label"><span class="enrich-icon">📋</span>模板复核要求</div>' +
      '<div class="enrichment-value">' + escapeHtml(p.reviewRequirements) + '</div>' +
    '</div>';
  } else {
    html += '<div class="enrichment-item requirement muted">' +
      '<div class="enrichment-label"><span class="enrich-icon">📋</span>模板复核要求</div>' +
      '<div class="enrichment-value">无特定模板复核要求</div>' +
    '</div>';
  }

  if (p.latestProcessSummary) {
    const s = p.latestProcessSummary;
    html += '<div class="enrichment-item process">' +
      '<div class="enrichment-label"><span class="enrich-icon">📝</span>最近过程记录</div>' +
      '<div class="enrichment-value">' +
        '<div class="process-meta">' + escapeHtml(s.operator) + ' · ' + escapeHtml(s.date) + '</div>' +
        '<div class="process-steps">' + escapeHtml(s.steps) + '</div>' +
        (s.notes ? '<div class="process-notes">备注：' + escapeHtml(s.notes) + '</div>' : '') +
      '</div>' +
    '</div>';
  } else {
    html += '<div class="enrichment-item process muted">' +
      '<div class="enrichment-label"><span class="enrich-icon">📝</span>最近过程记录</div>' +
      '<div class="enrichment-value">暂无过程记录</div>' +
    '</div>';
  }

  html += '<div class="enrichment-item photos">' +
    '<div class="enrichment-label"><span class="enrich-icon">📷</span>照片档案</div>' +
    '<div class="enrichment-value">' +
      '<span class="photo-count-badge">' + (p.photoCount || 0) + '</span> 张照片' +
    '</div>' +
  '</div>';

  if (p.overdue) {
    html += '<div class="enrichment-item overdue">' +
      '<div class="enrichment-label"><span class="enrich-icon">⚠️</span>项目状态</div>' +
      '<div class="enrichment-value"><span class="overdue-tag">已逾期</span></div>' +
    '</div>';
  } else {
    html += '<div class="enrichment-item on-schedule">' +
      '<div class="enrichment-label"><span class="enrich-icon">✅</span>项目状态</div>' +
      '<div class="enrichment-value"><span class="on-schedule-tag">按期进行中</span></div>' +
    '</div>';
  }

  if (p.lastRejection) {
    html += '<div class="enrichment-item rejection">' +
      '<div class="enrichment-label"><span class="enrich-icon">🔄</span>最近退回原因</div>' +
      '<div class="enrichment-value">' +
        '<div class="rejection-meta">' + escapeHtml(p.lastRejection.reviewer) + ' · ' + escapeHtml(p.lastRejection.reviewedAt) + '</div>' +
        '<div class="rejection-opinion">' + escapeHtml(p.lastRejection.opinion) + '</div>' +
      '</div>' +
    '</div>';
  }

  html += '</div>';
  return html;
}

function render() {
  if (!currentUser || currentUser.role !== "admin") {
    noPermission.style.display = "block";
    emptyState.style.display = "none";
    reviewList.innerHTML = "";
    reviewStats.innerHTML = "";
    return;
  }

  noPermission.style.display = "none";

  if (pendingProjects.length === 0) {
    emptyState.style.display = "block";
    reviewList.innerHTML = "";
  } else {
    emptyState.style.display = "none";
    reviewList.innerHTML = pendingProjects.map((p) => {
      const cls = p.overdue ? 'overdue' : '';
      return (
        '<article class="' + cls + '">' +
          '<div class="row"><h3>' + escapeHtml(p.title) + '</h3>' +
            '<span class="pill pending">待复核</span>' +
            (p.overdue ? '<span class="pill overdue-pill">逾期</span>' : '') +
            (p.lastRejection ? '<span class="pill reject-pill">曾退回</span>' : '') +
          '</div>' +
          '<div class="meta">' + escapeHtml(p.era) + ' · ' + escapeHtml(p.owner) + ' · 预计 ' + escapeHtml(p.dueDate) + '</div>' +
          '<div><b>破损</b> ' + escapeHtml(p.damage) + '</div>' +
          '<div><b>步骤</b> ' + escapeHtml(p.steps) + '</div>' +
          '<div><b>材料</b> ' + escapeHtml(p.materials) + '</div>' +
          renderEnrichment(p) +
          renderHistory(p.reviewRecords) +
          '<div class="actions">' +
            '<button class="secondary" data-action="review" data-id="' + escapeHtml(p.id) + '">开始复核</button>' +
            '<button data-action="history" data-id="' + escapeHtml(p.id) + '">查看详情</button>' +
          '</div>' +
        '</article>'
      );
    }).join("");

    reviewList.querySelectorAll('button[data-action="review"]').forEach((btn) => {
      btn.onclick = () => openReviewModal(btn.dataset.id);
    });

    reviewList.querySelectorAll('button[data-action="history"]').forEach((btn) => {
      btn.onclick = () => openDetailModal(btn.dataset.id);
    });
  }

  renderStats();
}

function buildProjectDetailHtml(p) {
  let html = '<div class="project-detail">';

  if (p.lastRejection) {
    html += '<div class="modal-rejection-banner">' +
      '<div class="modal-rejection-icon">⚠️</div>' +
      '<div class="modal-rejection-content">' +
        '<div class="modal-rejection-title">最近退回原因</div>' +
        '<div class="modal-rejection-meta">' + escapeHtml(p.lastRejection.reviewer) + ' · ' + escapeHtml(p.lastRejection.reviewedAt) + '</div>' +
        '<div class="modal-rejection-opinion">' + escapeHtml(p.lastRejection.opinion) + '</div>' +
      '</div>' +
    '</div>';
  }

  html += '<div class="detail-row"><span class="detail-label">编号</span><span>' + escapeHtml(p.id) + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">年代</span><span>' + escapeHtml(p.era) + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">负责人</span><span>' + escapeHtml(p.owner) + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">预计完成</span><span>' + escapeHtml(p.dueDate) + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">破损情况</span><span>' + escapeHtml(p.damage) + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">修复步骤</span><span>' + escapeHtml(p.steps) + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">使用材料</span><span>' + escapeHtml(p.materials) + '</span></div>';

  if (p.reviewRequirements) {
    html += '<div class="detail-row detail-highlight detail-requirement">' +
      '<span class="detail-label">📋 复核要求</span>' +
      '<span>' + escapeHtml(p.reviewRequirements) + '</span>' +
    '</div>';
  }

  html += '<div class="detail-row"><span class="detail-label">📷 照片数量</span><span><strong>' + (p.photoCount || 0) + '</strong> 张</span></div>';

  if (p.overdue) {
    html += '<div class="detail-row detail-overdue"><span class="detail-label">⚠️ 项目状态</span><span class="danger"><strong>已逾期</strong></span></div>';
  } else {
    html += '<div class="detail-row detail-on-schedule"><span class="detail-label">✅ 项目状态</span><span class="success">按期进行中</span></div>';
  }

  html += '</div>';

  if (p.latestProcessSummary) {
    const s = p.latestProcessSummary;
    html += '<div class="detail-process-summary">' +
      '<div class="detail-process-title">📝 最近过程记录</div>' +
      '<div class="detail-process-meta">' + escapeHtml(s.operator) + ' · ' + escapeHtml(s.date) + '</div>' +
      '<div class="detail-process-steps">' + escapeHtml(s.steps) + '</div>' +
      (s.notes ? '<div class="detail-process-notes">备注：' + escapeHtml(s.notes) + '</div>' : '') +
    '</div>';
  } else {
    html += '<div class="detail-process-summary muted">' +
      '<div class="detail-process-title">📝 最近过程记录</div>' +
      '<div class="detail-process-steps">暂无过程记录</div>' +
    '</div>';
  }

  return html;
}

function openReviewModal(projectId) {
  selectedProject = pendingProjects.find((p) => p.id === projectId);
  if (!selectedProject) return;

  modalTitle.textContent = "项目复核 - " + selectedProject.title;
  projectInfo.innerHTML = buildProjectDetailHtml(selectedProject) + renderHistory(selectedProject.reviewRecords);

  reviewOpinion.value = "";
  reviewModal.style.display = "flex";
  setTimeout(() => reviewOpinion.focus(), 100);
}

function openDetailModal(projectId) {
  const project = pendingProjects.find((p) => p.id === projectId);
  if (!project) return;

  modalTitle.textContent = "项目详情 - " + project.title;
  projectInfo.innerHTML = buildProjectDetailHtml(project) + renderHistory(project.reviewRecords);

  reviewOpinion.style.display = "none";
  approveBtn.style.display = "none";
  rejectBtn.style.display = "none";
  reviewModal.style.display = "flex";
}

function closeModal() {
  reviewModal.style.display = "none";
  selectedProject = null;
  reviewOpinion.style.display = "block";
  approveBtn.style.display = "inline-block";
  rejectBtn.style.display = "inline-block";
}

async function submitReview(result) {
  if (!selectedProject) return;

  const opinion = reviewOpinion.value.trim();
  if (!opinion) {
    alert("请填写复核意见");
    return;
  }

  if (!confirm("确定要" + result + "该项目的复核吗？")) {
    return;
  }

  try {
    const res = await api("/api/projects/" + selectedProject.id + "/review", {
      method: "POST",
      body: JSON.stringify({ result, opinion })
    });

    if (res._dataVersionConflict) {
      handleDataVersionConflict(res, {
        pageLabel: "提交复核",
        onRetry: async () => {
          await load();
          if (selectedProject) {
            const retryRes = await api("/api/projects/" + selectedProject.id + "/review", {
              method: "POST",
              body: JSON.stringify({ result, opinion })
            });
            if (!retryRes.error && !retryRes._dataVersionConflict) {
              alert("复核已提交，项目状态已更新为：" + retryRes.project.status);
              closeModal();
            }
          }
          await load();
        }
      });
      return;
    }

    if (res.error) {
      alert("操作失败：" + (res.message || res.error));
      return;
    }

    alert("复核已提交，项目状态已更新为：" + res.project.status);
    closeModal();
    await load();
  } catch (err) {
    alert("提交失败：" + err.message);
  }
}

async function load() {
  users = await api("/api/users");

  viewer.innerHTML = users.map((u) => '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.name) + ' · ' + escapeHtml(u.role) + '</option>').join("");
  if (!viewer.value && users.length > 0) viewer.value = users[0].id;

  currentUser = users.find((u) => u.id === viewer.value) || users[0];

  if (currentUser && currentUser.role === "admin") {
    pendingProjects = await api("/api/projects/pending-review");
  } else {
    pendingProjects = [];
  }

  render();
}

viewer.onchange = load;
modalClose.onclick = closeModal;
reviewModal.querySelector(".modal-overlay").onclick = closeModal;

approveBtn.onclick = () => submitReview("通过");
rejectBtn.onclick = () => submitReview("退回");

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && reviewModal.style.display === "flex") {
    closeModal();
  }
});

load();
