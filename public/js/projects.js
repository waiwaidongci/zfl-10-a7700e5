const viewer = document.querySelector("#viewer");
const form = document.querySelector("#form");
const projectsEl = document.querySelector("#projects");
const statsEl = document.querySelector("#stats");
const intakeSelect = document.querySelector("#intakeSelect");
const intakeInfo = document.querySelector("#intakeInfo");
const templateSelectContainer = document.querySelector("#templateSelectContainer");
const materialCheckboxes = document.querySelector("#materialCheckboxes");
const stockHint = document.querySelector("#stockHint");
const filterStatus = document.querySelector("#filterStatus");
const filterOwner = document.querySelector("#filterOwner");
const filterOverdue = document.querySelector("#filterOverdue");
const filterTemplate = document.querySelector("#filterTemplate");
const filterReset = document.querySelector("#filterReset");

let users = [];
let projects = [];
let intakes = [];
let materials = [];
let templates = [];
let expandedProjectId = null;
let detailInstance = null;
let templateSelector = null;
let templateDiffModal = null;
let filtersLoadedFromUrl = false;

async function api(path, options) {
  if (window.SyncManager) {
    return window.SyncManager.api(path, options);
  }
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

function handleDataVersionConflict(errorData, options) {
  if (!window.DataVersionConflictHandler) {
    alert("数据已被其他操作修改，请刷新页面后重试。");
    location.reload();
    return;
  }
  var formEl = options && options.formEl;
  var formData = formEl ? window.DataVersionConflictHandler.saveFormData(formEl) : (options && options.formData);
  window.DataVersionConflictHandler.handleConflict(errorData, {
    pageLabel: options && options.pageLabel ? options.pageLabel : "项目",
    formData: formData,
    formEl: formEl,
    onReload: function() { location.reload(); },
    onSaveDraft: function(data) {
      if (window.SyncManager && data) {
        return false;
      }
      return window.DataVersionConflictHandler.saveDraftToLocalStorage("proj_" + Date.now(), data, "项目");
    },
    onRetry: options && options.onRetry ? options.onRetry : function() {
      load();
    }
  });
}

function isOverdue(project) {
  return project.status !== "已完成" && new Date(project.dueDate) < new Date(new Date().toISOString().slice(0, 10));
}

function getLatestTimeline(p) {
  if (!p.timelineRecords || p.timelineRecords.length === 0) return null;
  return [...p.timelineRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusClass(s) {
  if (s === '待复核') return 'pending';
  if (s === '已完成') return 'done';
  return 'active';
}

function getFiltersStorageKey() {
  const viewerId = viewer ? viewer.value : 'default';
  return 'projectFilters_' + viewerId;
}

function saveFilters() {
  const filters = {
    status: filterStatus.value,
    owner: filterOwner.value,
    overdue: filterOverdue.value,
    template: filterTemplate.value
  };
  try {
    localStorage.setItem(getFiltersStorageKey(), JSON.stringify(filters));
  } catch (e) {}

  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.owner) params.set('owner', filters.owner);
  if (filters.overdue) params.set('overdue', filters.overdue);
  if (filters.template) params.set('template', filters.template);
  const qs = params.toString();
  const newUrl = window.location.pathname + (qs ? '?' + qs : '');
  window.history.replaceState(null, '', newUrl);
}

function loadFilters(visibleProjects) {
  const validOwners = visibleProjects ? [...new Set(visibleProjects.map(p => p.owner))] : [];
  let filters = null;

  const params = new URLSearchParams(window.location.search);
  if (params.has('status') || params.has('owner') || params.has('overdue') || params.has('template')) {
    filters = {
      status: params.get('status') || '',
      owner: params.get('owner') || '',
      overdue: params.get('overdue') || '',
      template: params.get('template') || ''
    };
  }

  if (!filters) {
    try {
      const stored = localStorage.getItem(getFiltersStorageKey());
      if (stored) filters = JSON.parse(stored);
    } catch (e) {}
  }

  if (!filters) return;

  if (filters.status && filterStatus) {
    const validStatuses = [...filterStatus.options].map(o => o.value);
    if (validStatuses.includes(filters.status)) {
      filterStatus.value = filters.status;
    }
  }
  if (filters.overdue && filterOverdue) filterOverdue.value = filters.overdue;
  if (filters.template && filterTemplate) filterTemplate.value = filters.template;
  if (filters.owner && filterOwner) {
    if (validOwners.length === 0 || validOwners.includes(filters.owner)) {
      filterOwner.value = filters.owner;
    }
  }
}

function resetFilters() {
  filterStatus.value = '';
  filterOwner.value = '';
  filterOverdue.value = '';
  filterTemplate.value = '';
  saveFilters();
}

function applyFilters(list) {
  let filtered = list;
  if (filterStatus.value) {
    filtered = filtered.filter(p => p.status === filterStatus.value);
  }
  if (filterOwner.value) {
    filtered = filtered.filter(p => p.owner === filterOwner.value);
  }
  if (filterOverdue.value === 'yes') {
    filtered = filtered.filter(isOverdue);
  } else if (filterOverdue.value === 'no') {
    filtered = filtered.filter(p => !isOverdue(p));
  }
  if (filterTemplate.value === 'yes') {
    filtered = filtered.filter(p => !!p.templateSnapshot);
  } else if (filterTemplate.value === 'no') {
    filtered = filtered.filter(p => !p.templateSnapshot);
  }
  return filtered;
}

function renderOwnerOptions(visibleProjects) {
  const owners = [...new Set(visibleProjects.map(p => p.owner))].sort();
  const current = filterOwner.value;
  filterOwner.innerHTML =
    '<option value="">全部</option>' +
    owners.map(o => '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + '</option>').join('');
  if (owners.includes(current)) {
    filterOwner.value = current;
  }
}

function render() {
  const user = users.find((item) => item.id === viewer.value) || users[0];
  const isAdmin = user.role === "admin";
  const visible = isAdmin ? projects : projects.filter((item) => item.owner === user.name);

  renderOwnerOptions(visible);

  if (!filtersLoadedFromUrl) {
    loadFilters(visible);
    filtersLoadedFromUrl = true;
  }

  const filtered = applyFilters(visible);

  const realFiltered = filtered.filter(p => !p._isDraft);
  const active = realFiltered.filter((item) => item.status !== "已完成").length;
  const overdue = realFiltered.filter(isOverdue).length;
  const completed = realFiltered.filter((item) => item.status === "已完成").length;
  const workload = realFiltered.reduce((map, item) => {
    map[item.owner] = (map[item.owner] || 0) + 1;
    return map;
  }, {});

  const hasFilter = filterStatus.value || filterOwner.value || filterOverdue.value || filterTemplate.value;

  statsEl.innerHTML =
    '<div class="stat"><span>进行中</span><strong>' + active + '</strong></div>' +
    '<div class="stat"><span>逾期</span><strong>' + overdue + '</strong></div>' +
    '<div class="stat"><span>已完成</span><strong>' + completed + '</strong></div>' +
    '<div class="stat"><span>负责人工作量</span><strong>' +
    Object.entries(workload).map(([k, v]) => k + v).join(" / ") +
    '</strong></div>';

  const filterBarEl = document.querySelector('#filterBar');
  const existingCount = filterBarEl.querySelector('.filter-result-count');
  if (existingCount) existingCount.remove();
  if (hasFilter) {
    const span = document.createElement('span');
    span.className = 'filter-result-count';
    span.textContent = '筛选结果：' + filtered.length + ' / ' + visible.length;
    filterBarEl.appendChild(span);
  }

  projectsEl.innerHTML = filtered.map((p) => {
    const isDraft = p._isDraft === true;
    const cls = (isOverdue(p) ? 'overdue' : '') + (isDraft ? ' draft-project' : '');
    const expanded = expandedProjectId === p.id;
    const latest = getLatestTimeline(p);
    const latestHtml = latest
      ? (latest.type === 'system'
          ? '<div class="timeline-latest"><span class="timeline-dot system"></span><b>[系统]</b> ' + escapeHtml(latest.systemMessage) + ' <span class="meta">' + escapeHtml(latest.date) + '</span></div>'
          : '<div class="timeline-latest"><span class="timeline-dot manual"></span><b>' + escapeHtml(latest.operator) + '</b>：' + escapeHtml(latest.steps).slice(0, 30) + (latest.steps.length > 30 ? '…' : '') + ' <span class="meta">' + escapeHtml(latest.date) + '</span></div>')
      : '<div class="timeline-empty">暂无过程记录</div>';

    var photoCount = 0;
    if (p.photoArchive) {
      photoCount = (p.photoArchive.before || []).length + (p.photoArchive.during || []).length + (p.photoArchive.after || []).length;
    }
    var photoBadge = photoCount > 0 ? ' <span class="photo-count-badge">' + photoCount + '</span>' : '';

    let snapshotBadge = '';
    if (p.templateSnapshot) {
      const snap = p.templateSnapshot;
      snapshotBadge = '<div class="meta template-snapshot-badge" title="应用于 ' + escapeHtml(snap.appliedAt || '') + '">📋 模板：' + escapeHtml(snap.templateName) + ' v' + snap.templateVersion + '</div>';
    }

    let draftBadge = '';
    if (isDraft) {
      draftBadge = '<div class="meta draft-badge" title="此为本地草稿，尚未同步到服务端">📝 本地草稿</div>';
    }

    const articleCls = (expanded ? 'expanded ' : '') + cls;
    const detailBtnCls = 'card-detail-btn' + (expanded ? ' active' : '');
    const detailBtnText = expanded ? '收起详情 ▲' : '查看详情 ▼';

    let html =
      '<article class="' + articleCls + '" data-article-id="' + escapeHtml(p.id) + '">' +
      '<div class="row"><h3>' + escapeHtml(p.title) + '</h3><span class="pill ' + statusClass(p.status) + '">' + escapeHtml(p.status) + '</span></div>' +
      '<div class="meta">' + escapeHtml(p.era) + ' · ' + escapeHtml(p.owner) + ' · ' + escapeHtml(p.dueDate) + '</div>' +
      snapshotBadge +
      draftBadge +
      '<div><b>破损</b> ' + escapeHtml(p.damage) + '</div>' +
      '<div><b>步骤</b> ' + escapeHtml(p.steps) + '</div>' +
      '<div><b>材料</b> ' + escapeHtml(p.materials) + '</div>' +
      latestHtml +
      (isOverdue(p) ? '<div class="danger">已超过预计完成日期</div>' : '') +
      (isDraft ? '<div class="draft-warning">⚠️ 此为本地草稿，请在同步管理中手动同步到服务端</div>' : '') +
      '<div class="card-actions">' +
      '<select data-id="' + p.id + '" ' + (isDraft ? 'disabled' : '') + '>' +
      '<option>进行中</option>' +
      '<option>待复核</option>' +
      '<option>已完成</option>' +
      '</select>' +
      '<button class="' + detailBtnCls + '" data-detail="' + escapeHtml(p.id) + '" ' + (isDraft ? 'disabled' : '') + '>' + detailBtnText + '</button>' +
      '<button class="secondary photo-btn" data-project="' + p.id + '" ' + (isDraft ? 'disabled' : '') + '>📷照片' + photoBadge + '</button>' +
      '<button class="secondary timeline-btn" data-project="' + p.id + '" ' + (isDraft ? 'disabled' : '') + '>过程时间线</button>' +
      (isAdmin && p.status === '已完成' && !isDraft ? '<button class="secondary report-btn" data-report="' + escapeHtml(p.id) + '">📄生成报告</button>' : '') +
      '</div>' +
      '</article>';

    if (expanded) {
      html +=
        '<div class="pdx-wrapper" data-wrapper-id="' + escapeHtml(p.id) + '">' +
        '<div class="pdx-container" data-container-id="' + escapeHtml(p.id) + '"></div>' +
        '</div>';
    }

    return html;
  }).join("");

  document.querySelectorAll("article select").forEach((select) => {
    const project = projects.find((item) => item.id === select.dataset.id);
    select.value = project.status;
    select.onchange = async () => {
      const result = await api('/api/projects/' + project.id, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
      if (result._dataVersionConflict) {
        handleDataVersionConflict(result, {
          pageLabel: "项目状态",
          onRetry: async () => {
            await load();
            const updatedProject = projects.find(p => p.id === project.id);
            if (updatedProject) {
              await api('/api/projects/' + updatedProject.id, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
              await load();
            }
          }
        });
        return;
      }
      await load();
    };
  });

  document.querySelectorAll(".timeline-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const p = projects.find((item) => item.id === btn.dataset.project);
      if (p && window.Timeline) window.Timeline.open(p, users);
    };
  });

  document.querySelectorAll(".photo-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const p = projects.find((item) => item.id === btn.dataset.project);
      if (p && window.Photos) window.Photos.open(p);
    };
  });

  document.querySelectorAll(".card-detail-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const projectId = btn.dataset.detail;
      if (expandedProjectId === projectId) {
        expandedProjectId = null;
        detailInstance = null;
      } else {
        expandedProjectId = projectId;
      }
      render();
      if (expandedProjectId) {
        initDetailView(expandedProjectId);
      }
    };
  });

  document.querySelectorAll(".report-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const projectId = btn.dataset.report;
      if (projectId) {
        window.location.href = "/report.html?projectId=" + encodeURIComponent(projectId);
      }
    };
  });
}

function initDetailView(projectId) {
  const container = document.querySelector('[data-container-id="' + projectId + '"]');
  if (!container) return;

  const p = projects.find((item) => item.id === projectId);
  if (!p) return;

  const user = users.find((item) => item.id === viewer.value) || users[0];
  const isAdmin = user.role === "admin";

  if (window.ProjectDetail) {
    detailInstance = new window.ProjectDetail(container, {
      project: p,
      users: users,
      editable: true,
      isAdmin: isAdmin,
      onStatusChange: async (pid, newStatus) => {
        const result = await api('/api/projects/' + pid, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
        if (result._dataVersionConflict) {
          handleDataVersionConflict(result, {
            pageLabel: "项目详情状态",
            formData: { projectId: pid, status: newStatus },
            onRetry: async () => {
              await load();
              const updatedProject = projects.find(p => p.id === pid);
              if (updatedProject) {
                const retryResult = await api('/api/projects/' + pid, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: newStatus })
                });
                if (!retryResult._dataVersionConflict && !retryResult.error) {
                  await load();
                }
              }
            }
          });
          return;
        }
        await load();
      },
      onOpenPhotos: (project) => {
        if (project && window.Photos) window.Photos.open(project);
      },
      onOpenTimeline: (project) => {
        if (project && window.Timeline) window.Timeline.open(project, users);
      },
      onOpenAudit: (project) => {
        if (project && window.AuditLog) window.AuditLog.open(project, users);
      },
      onOpenTemplateDiff: (project) => {
        if (project && templateDiffModal) {
          templateDiffModal.open(project.id);
        }
      }
    });
  } else {
    container.innerHTML = '<div class="pd-error">ProjectDetail 组件未加载，请刷新页面重试</div>';
  }
}

function renderIntakeOptions() {
  const pendingIntakes = intakes.filter((i) => i.status === "待修复" && !i.projectId);
  if (pendingIntakes.length === 0) {
    intakeSelect.innerHTML = '<option value="">暂无可选入库记录</option>';
    return;
  }
  intakeSelect.innerHTML =
    '<option value="">选择入库记录带入信息</option>' +
    pendingIntakes.map((i) => '<option value="' + i.id + '">' + escapeHtml(i.title) + '（' + escapeHtml(i.era) + '）</option>').join("");
}

function onIntakeChange() {
  const intakeId = intakeSelect.value;
  if (!intakeId) {
    intakeInfo.style.display = 'none';
    return;
  }
  const intake = intakes.find((i) => i.id === intakeId);
  if (!intake) return;

  form.title.value = intake.title;
  form.era.value = intake.era || '';
  form.damage.value = intake.damage || '';

  intakeInfo.innerHTML =
    '<b>来源：</b>' + escapeHtml(intake.source) + '<br>' +
    '<b>接收人：</b>' + escapeHtml(intake.receiver) + '<br>' +
    '<b>接收时间：</b>' + escapeHtml(intake.receivedAt) + '<br>' +
    '<b>存放位置：</b>' + escapeHtml(intake.tempLocation);
  intakeInfo.style.display = 'block';
}

function renderMaterialCheckboxes() {
  if (materials.length === 0) {
    materialCheckboxes.innerHTML = '<span style="font-size: 13px; color: #6b6258;">暂无库存材料</span>';
    return;
  }
  materialCheckboxes.innerHTML = materials.map((m) => {
    const low = m.quantity <= m.lowStockThreshold;
    const cls = low ? 'low-stock' : '';
    return (
      '<label class="' + cls + '">' +
      '<input type="checkbox" value="' + m.id + '" data-name="' + escapeHtml(m.name) + '">' +
      escapeHtml(m.name) + '（' + m.quantity + escapeHtml(m.unit) + '）' +
      '</label>'
    );
  }).join('');

  materialCheckboxes.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.onchange = onMaterialChange;
  });
}

function initTemplateSelector() {
  if (!window.TemplateSelector || !templateSelectContainer) return;
  templateSelector = new window.TemplateSelector(templateSelectContainer, {
    groupByCategory: true,
    showPreview: true,
    onApply: (data) => {
      if (!data) return;
      const { applied } = data;
      if (applied.steps && !form.steps.value.trim()) {
        form.steps.value = applied.steps;
      }
      if (applied.materials && !form.materials.value.trim()) {
        form.materials.value = applied.materials;
      }
      if (applied.dueDate && !form.dueDate.value) {
        form.dueDate.value = applied.dueDate;
      }
    }
  });
  templateSelector.setTemplates(templates);
}

function onMaterialChange() {
  const selected = [];
  const selectedMaterials = [];

  materialCheckboxes.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
    const material = materials.find((m) => m.id === cb.value);
    if (material) {
      selected.push(material.name);
      selectedMaterials.push(material);
    }
  });

  if (selected.length > 0) {
    const currentValue = form.materials.value;
    if (!currentValue || currentValue.trim() === '') {
      form.materials.value = selected.join('、');
    } else {
      const existingMaterials = currentValue.split(/[、,，]/).map(s => s.trim()).filter(s => s);
      const merged = [...new Set([...existingMaterials, ...selected])];
      form.materials.value = merged.join('、');
    }
  }

  updateStockHint(selectedMaterials);
}

function updateStockHint(selectedMaterials) {
  if (selectedMaterials.length === 0) {
    stockHint.style.display = 'none';
    return;
  }

  const lowStockItems = selectedMaterials.filter(m => m.quantity <= m.lowStockThreshold);

  let html = '<b>已选材料库存：</b><br>';
  selectedMaterials.forEach((m) => {
    const low = m.quantity <= m.lowStockThreshold;
    html += '· ' + escapeHtml(m.name) + '：' + m.quantity + escapeHtml(m.unit);
    if (low) {
      html += ' <span class="low">（库存不足）</span>';
    }
    html += '<br>';
  });

  if (lowStockItems.length > 0) {
    html += '<br><span class="low">注意：有 ' + lowStockItems.length + ' 种材料库存不足，请及时补充</span>';
  }

  stockHint.innerHTML = html;
  stockHint.style.display = 'block';
}

async function load() {
  users = await api("/api/users");

  viewer.innerHTML = users.map((u) => '<option value="' + u.id + '">' + escapeHtml(u.name) + ' · ' + escapeHtml(u.role) + '</option>').join("");
  const savedViewerId = localStorage.getItem("viewerId");
  if (savedViewerId && users.find(u => u.id === savedViewerId)) {
    viewer.value = savedViewerId;
  } else if (!viewer.value) {
    viewer.value = users[0].id;
  }
  localStorage.setItem("viewerId", viewer.value);

  if (window.Timeline) window.Timeline.setUser(users.find(u => u.id === viewer.value) || users[0]);

  projects = await api("/api/projects");
  if (window.SyncManager) {
    projects = window.SyncManager.mergeProjectsWithDrafts(projects);
  }
  intakes = await api("/api/intakes");
  materials = await api("/api/materials");
  templates = await api("/api/templates");

  renderIntakeOptions();
  renderMaterialCheckboxes();
  if (!templateSelector) {
    initTemplateSelector();
  } else {
    templateSelector.setTemplates(templates);
  }
  filtersLoadedFromUrl = false;
  render();
}

window.onTimelineUpdated = async (projectId) => {
  projects = await api("/api/projects");
  render();
  if (expandedProjectId === projectId) {
    initDetailView(expandedProjectId);
  }
};

window.onPhotosUpdated = async (projectId) => {
  projects = await api("/api/projects");
  if (window.SyncManager) {
    projects = window.SyncManager.mergeProjectsWithDrafts(projects);
  }
  render();
  if (expandedProjectId === projectId) {
    initDetailView(expandedProjectId);
  }
};

window.onAuditRollback = async (projectId) => {
  projects = await api("/api/projects");
  if (window.SyncManager) {
    projects = window.SyncManager.mergeProjectsWithDrafts(projects);
  }
  render();
  if (expandedProjectId === projectId) {
    initDetailView(expandedProjectId);
  }
};

viewer.onchange = async () => {
  localStorage.setItem("viewerId", viewer.value);
  if (window.Timeline) window.Timeline.setUser(users.find(u => u.id === viewer.value) || users[0]);
  projects = await api("/api/projects");
  if (window.SyncManager) {
    projects = window.SyncManager.mergeProjectsWithDrafts(projects);
  }
  filtersLoadedFromUrl = false;
  render();
};

function onFilterChange() {
  saveFilters();
  render();
}

filterStatus.onchange = onFilterChange;
filterOwner.onchange = onFilterChange;
filterOverdue.onchange = onFilterChange;
filterTemplate.onchange = onFilterChange;
filterReset.onclick = () => {
  resetFilters();
  render();
};

intakeSelect.onchange = onIntakeChange;

form.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const intakeId = data.intakeId || null;
  delete data.intakeId;
  const templateId = templateSelector ? templateSelector.getValue() : null;
  if (templateId) {
    data.templateId = templateId;
  }
  if (intakeId) {
    data.intakeId = intakeId;
  }
  const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '保存中...';
  submitBtn.disabled = true;

  try {
    const result = await api("/api/projects", { method: "POST", body: JSON.stringify(data) });

    if (result._dataVersionConflict) {
      handleDataVersionConflict(result, {
        formEl: form,
        pageLabel: "新建项目",
        onRetry: async () => {
          await load();
          const retryResult = await api("/api/projects", { method: "POST", body: JSON.stringify(data) });
          if (!retryResult.error && !retryResult._dataVersionConflict) {
            form.reset();
            intakeInfo.style.display = 'none';
            if (templateSelector) templateSelector.reset();
            stockHint.style.display = 'none';
          }
          await load();
        }
      });
      return;
    }

    if (result._savedAsDraft) {
      alert('网络不可用，已保存为本地草稿。恢复连接后可在同步管理中手动同步。');
      form.reset();
      intakeInfo.style.display = 'none';
      if (templateSelector) templateSelector.reset();
      stockHint.style.display = 'none';
      await load();
      return;
    }

    if (result.conflict) {
      alert('检测到版本冲突，请在同步管理中处理。');
      return;
    }

    if (result.error) {
      alert(result.errors ? result.errors.join("\n") : result.error);
      return;
    }

    form.reset();
    intakeInfo.style.display = 'none';
    if (templateSelector) templateSelector.reset();
    stockHint.style.display = 'none';
    await load();
  } catch (error) {
    alert(error.message || '保存失败');
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
};

function initNetworkStatus() {
  if (!window.SyncManager) return;

  const networkStatusEl = document.querySelector('#network-status');
  if (!networkStatusEl) return;

  const updateStatus = (isOnline) => {
    const dot = networkStatusEl.querySelector('.status-dot');
    const text = networkStatusEl.querySelector('.status-text');
    if (dot && text) {
      dot.className = 'status-dot ' + (isOnline ? 'online' : 'offline');
      text.textContent = isOnline ? '在线' : '离线模式';
    }
  };

  window.SyncManager.onNetworkStatusChange(updateStatus);
}

function initTemplateDiffModal() {
  if (!window.TemplateDiffModal) return;
  const container = document.querySelector('#template-diff-container');
  if (!container) return;

  templateDiffModal = new window.TemplateDiffModal(container, {
    onSyncSuccess: async (result) => {
      await load();
      if (expandedProjectId && result?.project?.id === expandedProjectId) {
        initDetailView(expandedProjectId);
      }
    },
    onClose: () => {}
  });
}

function initSyncComponents() {
  if (!window.SyncPanel || !window.ConflictResolver) return;

  const conflictContainer = document.querySelector('#conflict-resolver-container');
  const conflictModal = document.querySelector('#conflict-modal');
  const syncPanelContainer = document.querySelector('#sync-panel-container');

  if (!conflictContainer || !syncPanelContainer) return;

  const conflictResolver = new window.ConflictResolver(conflictContainer, {
    onResolved: async (result) => {
      conflictModal.style.display = 'none';
      alert('同步成功！');
      if (typeof window.onSyncComplete === 'function') {
        window.onSyncComplete(result);
      }
      await load();
      if (result?.type === 'photos' && expandedProjectId) {
        if (window.Photos) {
          window.Photos.refresh();
        }
        if (typeof window.onPhotosUpdated === 'function') {
          window.onPhotosUpdated(expandedProjectId);
        }
      }
    },
    onCancel: () => {
      conflictModal.style.display = 'none';
    }
  });

  const syncPanel = new window.SyncPanel(syncPanelContainer, {
    conflictResolver,
    onConflict: (conflict, queueId, draftId) => {
      conflictModal.style.display = 'flex';
      conflictResolver.setConflict(conflict, queueId, draftId);
    },
    onSyncComplete: async () => {
      if (typeof window.onSyncComplete === 'function') {
        window.onSyncComplete();
      }
      await load();
    }
  });

  window.onSyncComplete = async () => {
    await load();
  };

  window._syncPanel = syncPanel;
  window._conflictResolver = conflictResolver;
}

initNetworkStatus();
initSyncComponents();
initTemplateDiffModal();
load();
