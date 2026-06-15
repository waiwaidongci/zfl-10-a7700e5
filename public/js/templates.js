const viewer = document.querySelector("#viewer");
const form = document.querySelector("#form");
const templatesEl = document.querySelector("#templates");
const statsEl = document.querySelector("#stats");
const adminHint = document.querySelector("#adminHint");
const workerHint = document.querySelector("#workerHint");

let users = [];
let templates = [];
let editingId = null;
let expandedVersionId = null;

async function api(path, options) {
  const headers = { "Content-Type": "application/json" };
  if (viewer && viewer.value) headers["X-Viewer-Id"] = viewer.value;
  const res = await fetch(path, options && options.body ? { ...options, headers } : (options ? { ...options, headers } : { headers }));
  return res.json();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isAdmin() {
  const user = users.find((u) => u.id === viewer.value);
  return user && user.role === "admin";
}

function applyPermissionUI() {
  const admin = isAdmin();
  form.style.display = admin ? "" : "none";
  adminHint.style.display = admin ? "" : "none";
  workerHint.style.display = admin ? "none" : "";
}

async function render() {
  applyPermissionUI();

  const total = templates.length;
  const categories = [...new Set(templates.map(t => t.category))];
  const avgDays = templates.length > 0 ? Math.round(templates.reduce((s, t) => s + t.estimatedDays, 0) / templates.length) : 0;

  statsEl.innerHTML =
    '<div class="stat"><span>模板总数</span><strong>' + total + '</strong></div>' +
    '<div class="stat"><span>藏品类型</span><strong>' + categories.length + '</strong></div>' +
    '<div class="stat"><span>平均工期</span><strong>' + avgDays + '天</strong></div>';

  if (templates.length === 0) {
    templatesEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#8a8278;padding:40px;">暂无流程模板，请添加</div>';
    return;
  }

  templatesEl.innerHTML = templates.map(t => {
    const reviewBadge = t.reviewRequired
      ? '<span class="pill active">需复核</span>'
      : '<span class="pill">无需复核</span>';
    const stepsPreview = escapeHtml(t.steps).split('\n').slice(0, 3).join('<br>');
    const stepsMore = t.steps.split('\n').length > 3 ? '<br><span class="meta">…共' + t.steps.split('\n').length + '步</span>' : '';
    const isEditing = editingId === t.id;
    const admin = isAdmin();

    let html =
      '<article class="template-card' + (isEditing ? ' editing' : '') + '" data-id="' + escapeHtml(t.id) + '">' +
      '<div class="row"><h3>' + escapeHtml(t.name) + '</h3>' + reviewBadge + '</div>' +
      '<div class="meta">' + escapeHtml(t.category) + ' · v' + t.version + ' · 预计' + t.estimatedDays + '天</div>' +
      '<div><b>步骤</b></div><div class="template-steps">' + stepsPreview + stepsMore + '</div>' +
      '<div><b>材料</b> ' + escapeHtml(t.materials) + '</div>';

    if (t.reviewRequired && t.reviewNotes) {
      html += '<div><b>复核要求</b> ' + escapeHtml(t.reviewNotes) + '</div>';
    }

    html += '<div class="meta">更新于 ' + escapeHtml(t.updatedAt) + '</div>';

    if (admin) {
      html += '<div class="card-actions">' +
        '<button class="secondary edit-btn" data-edit="' + escapeHtml(t.id) + '">' + (isEditing ? '取消编辑' : '编辑') + '</button>' +
        '<button class="secondary history-btn" data-history="' + escapeHtml(t.id) + '">版本历史</button>' +
        '<button class="secondary danger delete-btn" data-delete="' + escapeHtml(t.id) + '">删除</button>' +
        '</div>';
    } else {
      html += '<div class="card-actions">' +
        '<button class="secondary history-btn" data-history="' + escapeHtml(t.id) + '">查看版本历史</button>' +
        '</div>';
    }

    if (isEditing && admin) {
      html +=
        '<form class="edit-form" data-edit-form="' + escapeHtml(t.id) + '">' +
        '<label>模板名称</label><input name="name" value="' + escapeHtml(t.name) + '" required>' +
        '<label>藏品类型</label><input name="category" value="' + escapeHtml(t.category) + '" required>' +
        '<label>默认步骤</label><textarea name="steps" required>' + escapeHtml(t.steps) + '</textarea>' +
        '<label>建议材料</label><textarea name="materials" required>' + escapeHtml(t.materials) + '</textarea>' +
        '<label>预计工期（天）</label><input name="estimatedDays" type="number" min="1" value="' + t.estimatedDays + '" required>' +
        '<div class="template-review-row"><label class="checkbox-label"><input type="checkbox" name="reviewRequired"' + (t.reviewRequired ? ' checked' : '') + '> 需要复核</label></div>' +
        '<label>复核要求</label><textarea name="reviewNotes">' + escapeHtml(t.reviewNotes || '') + '</textarea>' +
        '<div class="card-actions"><button type="submit">保存修改</button><button type="button" class="secondary cancel-edit-btn" data-cancel="' + escapeHtml(t.id) + '">取消</button></div>' +
        '</form>';
    }

    if (expandedVersionId === t.id) {
      html += '<div class="version-history" id="versionHistory-' + escapeHtml(t.id) + '">加载中...</div>';
    }

    html += '</article>';
    return html;
  }).join("");

  document.querySelectorAll(".edit-btn").forEach(btn => {
    btn.onclick = () => {
      editingId = editingId === btn.dataset.edit ? null : btn.dataset.edit;
      expandedVersionId = null;
      render();
    };
  });

  document.querySelectorAll(".cancel-edit-btn").forEach(btn => {
    btn.onclick = () => {
      editingId = null;
      render();
    };
  });

  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("确定删除该模板？已有项目不受影响。")) return;
      const result = await api("/api/templates/" + btn.dataset.delete, { method: "DELETE" });
      if (result.error) {
        alert(result.message || result.error);
        return;
      }
      await load();
    };
  });

  document.querySelectorAll(".history-btn").forEach(btn => {
    btn.onclick = async () => {
      const tplId = btn.dataset.history;
      if (expandedVersionId === tplId) {
        expandedVersionId = null;
        render();
      } else {
        expandedVersionId = tplId;
        editingId = null;
        render();
        await loadVersionHistory(tplId);
      }
    };
  });

  document.querySelectorAll(".edit-form").forEach(form => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      data.estimatedDays = Number(data.estimatedDays);
      data.reviewRequired = form.querySelector('[name="reviewRequired"]').checked;
      const result = await api("/api/templates/" + form.dataset.editForm, {
        method: "PATCH",
        body: JSON.stringify(data)
      });
      if (result.error) {
        alert(result.errors ? result.errors.join("\n") : (result.message || result.error));
        return;
      }
      editingId = null;
      await load();
    };
  });
}

async function loadVersionHistory(tplId) {
  const container = document.getElementById('versionHistory-' + tplId);
  if (!container) return;
  try {
    const versions = await api("/api/templates/" + tplId + "/versions");
    if (!Array.isArray(versions) || versions.length === 0) {
      container.innerHTML = '<div class="meta" style="padding:8px;">暂无版本历史记录</div>';
      return;
    }
    container.innerHTML =
      '<div style="margin-top:12px;padding-top:12px;border-top:1px dashed #d8d2c7;">' +
      '<div style="font-weight:700;margin-bottom:8px;">版本历史</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;">' +
      versions.map(v => `
        <div style="background:#faf7f0;border-radius:6px;padding:8px 10px;font-size:12px;">
          <div class="row" style="margin-bottom:4px;">
            <b>v${v.version}</b>
            <span class="meta">${escapeHtml(v.createdAt)} · ${escapeHtml(v.operator || '系统')}</span>
          </div>
          <div class="meta">${escapeHtml(v.name)} · ${escapeHtml(v.category)} · ${v.estimatedDays}天</div>
        </div>
      `).join('') +
      '</div></div>';
  } catch (e) {
    container.innerHTML = '<div class="danger" style="padding:8px;">加载版本历史失败</div>';
  }
}

async function load() {
  users = await api("/api/users");
  templates = await api("/api/templates");

  if (viewer) {
    viewer.innerHTML = users.map((u) => '<option value="' + u.id + '">' + escapeHtml(u.name) + ' · ' + escapeHtml(u.role) + '</option>').join("");
    const savedViewerId = localStorage.getItem("viewerId");
    if (savedViewerId && users.find(u => u.id === savedViewerId)) {
      viewer.value = savedViewerId;
    } else if (!viewer.value) {
      viewer.value = users[0].id;
    }
    localStorage.setItem("viewerId", viewer.value);
  }

  render();
}

form.onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  data.estimatedDays = Number(data.estimatedDays);
  data.reviewRequired = form.querySelector('[name="reviewRequired"]').checked;
  const result = await api("/api/templates", { method: "POST", body: JSON.stringify(data) });
  if (result.error) {
    alert(result.errors ? result.errors.join("\n") : (result.message || result.error));
    return;
  }
  form.reset();
  form.querySelector('[name="reviewRequired"]').checked = true;
  await load();
};

if (viewer) {
  viewer.onchange = () => {
    localStorage.setItem("viewerId", viewer.value);
    editingId = null;
    expandedVersionId = null;
    render();
  };
}

load();
