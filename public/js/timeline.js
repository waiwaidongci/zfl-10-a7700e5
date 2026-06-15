let currentProjectId = null;
let currentRecords = [];
let currentUser = null;

window.Timeline = {
  setUser(user) {
    currentUser = user;
  },

  async open(project, users) {
    currentProjectId = project.id;
    currentUser = currentUser || (users && users[0]);
    try {
      currentRecords = await api('/api/projects/' + project.id + '/timeline');
    } catch {
      currentRecords = [];
    }
    showModal(project, users);
  },

  getLatest(records) {
    if (!records || records.length === 0) return null;
    return [...records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  },

  formatLatestCard(record) {
    if (!record) return '<div class="timeline-empty">暂无过程记录</div>';
    const isSystem = record.type === "system";
    return (
      '<div class="timeline-latest">' +
        '<div class="timeline-latest-head">' +
          '<span class="timeline-dot ' + (isSystem ? 'system' : 'manual') + '"></span>' +
          '<b>' + (isSystem ? '[系统] ' + record.systemMessage : record.operator + ' · ' + record.date) + '</b>' +
        '</div>' +
        (isSystem ? '' : '<div class="timeline-latest-body">' + escapeHtml(record.steps).slice(0, 40) + (record.steps.length > 40 ? '…' : '') + '</div>') +
      '</div>'
    );
  }
};

function api(path, options) {
  const viewerEl = document.querySelector('#viewer');
  const viewerId = viewerEl ? viewerEl.value : '';
  const headers = { "Content-Type": "application/json" };
  if (viewerId) headers["X-Viewer-Id"] = viewerId;
  return fetch(path, options && options.body ? { ...options, headers } : (options ? { ...options, headers } : { headers })).then(r => r.json());
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showModal(project, users) {
  closeModal();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'timeline-modal';
  modal.innerHTML =
    '<div class="modal-overlay" data-close="1"></div>' +
    '<div class="modal-content">' +
      '<div class="modal-header">' +
        '<h3>修复过程时间线 — ' + escapeHtml(project.title) + '</h3>' +
        '<button class="modal-close" data-close="1">×</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="timeline-actions">' +
          '<button id="timeline-add-btn" class="secondary">+ 新增过程记录</button>' +
        '</div>' +
        '<div id="timeline-form-wrap" style="display:none;"></div>' +
        '<div id="timeline-alert" class="timeline-alert" style="display:none;"></div>' +
        '<div class="timeline-list" id="timeline-list"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  modal.querySelectorAll('[data-close]').forEach(el => el.onclick = closeModal);

  document.getElementById('timeline-add-btn').onclick = () => toggleForm(users);
  renderList();
}

function closeModal() {
  const m = document.getElementById('timeline-modal');
  if (m) m.remove();
}

function toggleForm(users) {
  const wrap = document.getElementById('timeline-form-wrap');
  const btn = document.getElementById('timeline-add-btn');
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    btn.style.display = 'none';
    renderForm(users);
  } else {
    wrap.style.display = 'none';
    btn.style.display = 'inline-block';
  }
}

function renderForm(users) {
  const wrap = document.getElementById('timeline-form-wrap');
  const viewerEl = document.querySelector('#viewer');
  const viewerId = viewerEl ? viewerEl.value : '';
  const currentViewer = (users || []).find(u => u.id === viewerId);

  wrap.innerHTML =
    '<div class="timeline-form panel">' +
      '<h4 style="margin:0 0 10px;">新增过程记录</h4>' +
      '<label>操作人</label>' +
      '<input id="tf-operator" value="' + escapeHtml(currentViewer ? currentViewer.name : '') + '">' +
      '<label>日期</label>' +
      '<input id="tf-date" type="date" value="' + new Date().toISOString().slice(0, 10) + '">' +
      '<label>处理步骤</label>' +
      '<textarea id="tf-steps" placeholder="如：拆线、干洗、补纸、压平"></textarea>' +
      '<label>使用材料</label>' +
      '<textarea id="tf-materials" placeholder="如：楮皮纸、小麦淀粉浆（选填）"></textarea>' +
      '<label>备注</label>' +
      '<textarea id="tf-notes" placeholder="补充说明（选填）"></textarea>' +
      '<label>照片链接</label>' +
      '<input id="tf-photo" placeholder="https://...（选填）">' +
      '<div class="timeline-form-actions">' +
        '<button id="tf-cancel" class="secondary">取消</button>' +
        '<button id="tf-submit">保存记录</button>' +
      '</div>' +
    '</div>';

  document.getElementById('tf-cancel').onclick = () => {
    wrap.style.display = 'none';
    document.getElementById('timeline-add-btn').style.display = 'inline-block';
  };
  document.getElementById('tf-submit').onclick = submitRecord;
}

function showAlert(message, isError) {
  const el = document.getElementById('timeline-alert');
  if (!el) return;
  el.className = 'timeline-alert ' + (isError ? 'error' : 'success');
  el.textContent = message;
  el.style.display = 'block';
  if (!isError) {
    setTimeout(() => { el.style.display = 'none'; }, 2500);
  }
}

async function submitRecord() {
  const payload = {
    operator: document.getElementById('tf-operator').value,
    date: document.getElementById('tf-date').value,
    steps: document.getElementById('tf-steps').value,
    materials: document.getElementById('tf-materials').value,
    notes: document.getElementById('tf-notes').value,
    photoUrl: document.getElementById('tf-photo').value
  };

  const submitBtn = document.getElementById('tf-submit');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '保存中...';
  submitBtn.disabled = true;

  try {
    const res = await api('/api/projects/' + currentProjectId + '/timeline', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res._savedAsDraft) {
      showAlert('网络不可用，已保存为本地草稿', false);
      document.getElementById('timeline-form-wrap').style.display = 'none';
      document.getElementById('timeline-add-btn').style.display = 'inline-block';
      if (typeof window.onTimelineUpdated === 'function') {
        window.onTimelineUpdated(currentProjectId, currentRecords);
      }
      return;
    }

    if (res.conflict) {
      showAlert('检测到版本冲突，请在同步管理中处理', true);
      return;
    }

    if (res.error) {
      let msg = res.message || '操作失败';
      if (res.errors && res.errors.length) {
        msg += '：' + res.errors.map(e => e.message).join('；');
      }
      showAlert(msg, true);
      return;
    }

    showAlert('记录已添加', false);
    currentRecords = await api('/api/projects/' + currentProjectId + '/timeline');
    document.getElementById('timeline-form-wrap').style.display = 'none';
    document.getElementById('timeline-add-btn').style.display = 'inline-block';
    renderList();

    if (typeof window.onTimelineUpdated === 'function') {
      window.onTimelineUpdated(currentProjectId, currentRecords);
    }
  } catch (error) {
    showAlert(error.message || '保存失败', true);
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

function renderList() {
  const list = document.getElementById('timeline-list');
  if (!currentRecords || currentRecords.length === 0) {
    list.innerHTML = '<div class="timeline-empty-full">还没有过程记录，点击上方「新增过程记录」开始记录修复过程。</div>';
    return;
  }

  const sorted = [...currentRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  list.innerHTML = sorted.map((r, idx) => {
    const isSystem = r.type === "system";
    return (
      '<div class="timeline-item ' + (isSystem ? 'system' : 'manual') + '">' +
        '<div class="timeline-item-line">' +
          '<span class="timeline-item-dot ' + (isSystem ? 'system' : 'manual') + '"></span>' +
          (idx < sorted.length - 1 ? '<span class="timeline-item-connector"></span>' : '') +
        '</div>' +
        '<div class="timeline-item-body">' +
          '<div class="timeline-item-head">' +
            (isSystem
              ? '<span class="timeline-badge system">系统</span> <b>' + escapeHtml(r.systemMessage || '状态变更') + '</b>'
              : '<span class="timeline-badge manual">人工</span> <b>' + escapeHtml(r.operator) + '</b>') +
            '<span class="timeline-item-date">' + escapeHtml(r.date) + '</span>' +
          '</div>' +
          (isSystem ? '' :
            '<div class="timeline-item-row"><span class="tl-label">处理步骤</span><span>' + escapeHtml(r.steps) + '</span></div>' +
            (r.materials ? '<div class="timeline-item-row"><span class="tl-label">使用材料</span><span>' + escapeHtml(r.materials) + '</span></div>' : '') +
            (r.notes ? '<div class="timeline-item-row"><span class="tl-label">备注</span><span>' + escapeHtml(r.notes) + '</span></div>' : '') +
            (r.photoUrl ? '<div class="timeline-item-row"><span class="tl-label">照片</span><a href="' + escapeHtml(r.photoUrl) + '" target="_blank" rel="noopener">查看照片 →</a></div>' : '')
          ) +
        '</div>' +
      '</div>'
    );
  }).join('');
}
