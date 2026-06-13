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

async function api(path, options) {
  const headers = { "Content-Type": "application/json" };
  if (currentUser) {
    headers["X-Viewer-Id"] = currentUser.id;
  }
  const res = await fetch(path, {
    ...options,
    headers: options && options.body ? { ...headers, ...options.headers } : headers
  });
  return res.json();
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toISOString().slice(0, 10);
}

function isOverdue(project) {
  return new Date(project.dueDate) < new Date(new Date().toISOString().slice(0, 10));
}

function renderStats() {
  const overdue = pendingProjects.filter(isOverdue).length;
  const workload = pendingProjects.reduce((map, item) => {
    map[item.owner] = (map[item.owner] || 0) + 1;
    return map;
  }, {});

  reviewStats.innerHTML =
    '<div class="stat"><span>待复核</span><strong>' + pendingProjects.length + '</strong></div>' +
    '<div class="stat"><span>已逾期</span><strong>' + overdue + '</strong></div>' +
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
          '<span class="history-reviewer">' + r.reviewer + '</span>' +
          '<span class="pill ' + (r.result === "通过" ? "done" : "active") + '">' + r.result + '</span>' +
          '<span class="history-date">' + r.reviewedAt + '</span>' +
        '</div>' +
        '<div class="history-opinion"><b>意见：</b>' + r.opinion + '</div>' +
      '</div>'
    )).join("") +
    '</div>';
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
      const cls = isOverdue(p) ? 'overdue' : '';
      return (
        '<article class="' + cls + '">' +
          '<div class="row"><h3>' + p.title + '</h3><span class="pill pending">待复核</span></div>' +
          '<div class="meta">' + p.era + ' · ' + p.owner + ' · 预计 ' + p.dueDate + '</div>' +
          '<div><b>破损</b> ' + p.damage + '</div>' +
          '<div><b>步骤</b> ' + p.steps + '</div>' +
          '<div><b>材料</b> ' + p.materials + '</div>' +
          (isOverdue(p) ? '<div class="danger">已超过预计完成日期</div>' : '') +
          renderHistory(p.reviewRecords) +
          '<div class="actions">' +
            '<button class="secondary" data-action="review" data-id="' + p.id + '">开始复核</button>' +
            '<button data-action="history" data-id="' + p.id + '">查看详情</button>' +
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

function openReviewModal(projectId) {
  selectedProject = pendingProjects.find((p) => p.id === projectId);
  if (!selectedProject) return;

  modalTitle.textContent = "项目复核 - " + selectedProject.title;
  projectInfo.innerHTML =
    '<div class="project-detail">' +
      '<div class="detail-row"><span class="detail-label">编号</span><span>' + selectedProject.id + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">年代</span><span>' + selectedProject.era + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">负责人</span><span>' + selectedProject.owner + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">预计完成</span><span>' + selectedProject.dueDate + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">破损情况</span><span>' + selectedProject.damage + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">修复步骤</span><span>' + selectedProject.steps + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">使用材料</span><span>' + selectedProject.materials + '</span></div>' +
    '</div>' +
    renderHistory(selectedProject.reviewRecords);

  reviewOpinion.value = "";
  reviewModal.style.display = "flex";
  setTimeout(() => reviewOpinion.focus(), 100);
}

function openDetailModal(projectId) {
  const project = pendingProjects.find((p) => p.id === projectId);
  if (!project) return;

  modalTitle.textContent = "项目详情 - " + project.title;
  projectInfo.innerHTML =
    '<div class="project-detail">' +
      '<div class="detail-row"><span class="detail-label">编号</span><span>' + project.id + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">年代</span><span>' + project.era + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">负责人</span><span>' + project.owner + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">预计完成</span><span>' + project.dueDate + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">破损情况</span><span>' + project.damage + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">修复步骤</span><span>' + project.steps + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">使用材料</span><span>' + project.materials + '</span></div>' +
    '</div>' +
    renderHistory(project.reviewRecords);

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

  viewer.innerHTML = users.map((u) => '<option value="' + u.id + '">' + u.name + ' · ' + u.role + '</option>').join("");
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
