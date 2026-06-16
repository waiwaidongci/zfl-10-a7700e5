let currentProjectId = null;
let currentRecords = [];
let currentUser = null;
let availableMaterials = [];
let selectedMaterialUsages = [];

function api(path, options) {
  if (window.SyncManager) {
    return window.SyncManager.api(path, options);
  }
  const viewerEl = document.querySelector('#viewer');
  const viewerId = viewerEl ? viewerEl.value : '';
  const headers = { "Content-Type": "application/json" };
  if (viewerId) headers["X-Viewer-Id"] = viewerId;
  return fetch(path, options && options.body ? { ...options, headers } : (options ? { ...options, headers } : { headers })).then(r => r.json());
}

window.Timeline = {
  setUser(user) {
    currentUser = user;
  },

  async open(project, users) {
    currentProjectId = project.id;
    currentUser = currentUser || (users && users[0]);
    try {
      const records = await api('/api/projects/' + project.id + '/timeline');
      currentRecords = this.mergeRecordsWithDrafts(records || []);
    } catch {
      currentRecords = [];
    }
    try {
      availableMaterials = await api('/api/materials');
    } catch {
      availableMaterials = [];
    }
    selectedMaterialUsages = [];
    showModal(project, users);
  },

  mergeRecordsWithDrafts(records) {
    if (!window.SyncManager) return records;
    const drafts = window.SyncManager.getDrafts().filter(
      d => d.type === 'timeline' && d.projectId === currentProjectId && d.operation === 'create'
    );
    const draftRecords = drafts.map(d => ({
      ...d.data,
      id: d.id,
      type: 'manual',
      version: d.baseVersion,
      createdAt: d.createdAt,
      _isDraft: true,
      _draftId: d.id
    }));
    return [...draftRecords, ...records];
  },

  getLatest(records) {
    if (!records || records.length === 0) return null;
    return [...records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  },

  formatLatestCard(record) {
    if (!record) return '<div class="timeline-empty">暂无过程记录</div>';
    const isSystem = record.type === "system";
    const isDraft = record._isDraft;
    return (
      '<div class="timeline-latest ' + (isDraft ? 'draft-record' : '') + '">' +
        '<div class="timeline-latest-head">' +
          '<span class="timeline-dot ' + (isSystem ? 'system' : 'manual') + (isDraft ? ' draft' : '') + '"></span>' +
          '<b>' + (isSystem ? '[系统] ' + record.systemMessage : record.operator + ' · ' + record.date) + '</b>' +
          (isDraft ? '<span class="timeline-badge draft">本地草稿</span>' : '') +
        '</div>' +
        (isSystem ? '' : '<div class="timeline-latest-body">' + escapeHtml(record.steps).slice(0, 40) + (record.steps.length > 40 ? '…' : '') + '</div>') +
      '</div>'
    );
  }
};

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isAdmin() {
  const viewerEl = document.querySelector('#viewer');
  const viewerId = viewerEl ? viewerEl.value : '';
  const usersEl = document.querySelector('#users-data');
  if (!usersEl) return false;
  try {
    const users = JSON.parse(usersEl.textContent || '[]');
    const viewer = users.find(u => u.id === viewerId);
    return viewer && viewer.role === 'admin';
  } catch {
    return false;
  }
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
    selectedMaterialUsages = [];
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
      '<label>材料消耗登记</label>' +
      '<div id="tf-materials-section">' +
        '<div id="tf-materials-list"></div>' +
        '<div class="tf-add-material-wrap">' +
          '<select id="tf-material-select">' +
            '<option value="">-- 选择材料 --</option>' +
            availableMaterials.map(m => 
              '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name) + '（库存：' + m.quantity + ' ' + escapeHtml(m.unit) + '）</option>'
            ).join('') +
          '</select>' +
          '<button type="button" id="tf-add-material" class="secondary">添加</button>' +
        '</div>' +
      '</div>' +
      '<label>使用材料（文字描述，选填）</label>' +
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
  document.getElementById('tf-add-material').onclick = addMaterialUsage;
  renderMaterialUsagesList();
}

function addMaterialUsage() {
  const select = document.getElementById('tf-material-select');
  const materialId = select.value;
  if (!materialId) {
    showAlert('请选择材料', true);
    return;
  }
  if (selectedMaterialUsages.some(u => u.materialId === materialId)) {
    showAlert('该材料已添加', true);
    return;
  }
  const material = availableMaterials.find(m => m.id === materialId);
  if (!material) return;

  selectedMaterialUsages.push({
    materialId: material.id,
    materialName: material.name,
    unit: material.unit,
    quantity: 1,
    available: material.quantity
  });

  select.value = '';
  renderMaterialUsagesList();
}

function removeMaterialUsage(materialId) {
  selectedMaterialUsages = selectedMaterialUsages.filter(u => u.materialId !== materialId);
  renderMaterialUsagesList();
}

function updateMaterialQuantity(materialId, value) {
  const usage = selectedMaterialUsages.find(u => u.materialId === materialId);
  if (usage) {
    usage.quantity = Number(value) || 0;
  }
}

function renderMaterialUsagesList() {
  const listEl = document.getElementById('tf-materials-list');
  if (!listEl) return;

  if (selectedMaterialUsages.length === 0) {
    listEl.innerHTML = '<div class="tf-materials-empty">暂未选择材料，可从下方选择库存材料并填写消耗数量</div>';
    return;
  }

  listEl.innerHTML = selectedMaterialUsages.map(u => {
    const material = availableMaterials.find(m => m.id === u.materialId);
    const stock = material ? material.quantity : u.available;
    const isLow = stock < u.quantity;
    return (
      '<div class="tf-material-row">' +
        '<span class="tf-material-name">' + escapeHtml(u.materialName) + '</span>' +
        '<input type="number" min="0" step="0.01" value="' + u.quantity + '" ' +
          'onchange="window.__tfUpdateQty(\'' + u.materialId + '\', this.value)" ' +
          'class="tf-material-qty" placeholder="数量">' +
        '<span class="tf-material-unit">' + escapeHtml(u.unit) + '</span>' +
        '<span class="tf-material-stock' + (isLow ? ' low' : '') + '">（库存：' + stock + '）</span>' +
        '<button type="button" class="tf-material-remove danger" onclick="window.__tfRemoveMat(\'' + u.materialId + '\')">×</button>' +
      '</div>'
    );
  }).join('');
}

window.__tfUpdateQty = function(materialId, value) {
  updateMaterialQuantity(materialId, value);
};

window.__tfRemoveMat = function(materialId) {
  removeMaterialUsage(materialId);
};

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
  const materialUsages = selectedMaterialUsages
    .filter(u => u.quantity > 0)
    .map(u => ({ materialId: u.materialId, quantity: Number(u.quantity) }));

  const payload = {
    operator: document.getElementById('tf-operator').value,
    date: document.getElementById('tf-date').value,
    steps: document.getElementById('tf-steps').value,
    materials: document.getElementById('tf-materials').value,
    notes: document.getElementById('tf-notes').value,
    photoUrl: document.getElementById('tf-photo').value,
    materialUsages: materialUsages
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
      showAlert('网络不可用，已保存为本地草稿，联网后可在同步管理中上传', false);
      currentRecords = window.Timeline.mergeRecordsWithDrafts(currentRecords || []);
      document.getElementById('timeline-form-wrap').style.display = 'none';
      document.getElementById('timeline-add-btn').style.display = 'inline-block';
      renderList();
      if (typeof window.onTimelineUpdated === 'function') {
        window.onTimelineUpdated(currentProjectId, currentRecords);
      }
      if (typeof window._syncPanel !== 'undefined' && window._syncPanel) {
        window._syncPanel.refresh();
      }
      return;
    }

    if (res.conflict) {
      showAlert('检测到版本冲突，请在同步管理中处理', true);
      return;
    }

    if (res.error) {
      let msg = res.message || '操作失败';
      if (res.error === 'insufficient_stock' && res.shortages && res.shortages.length) {
        const shortageMsgs = res.shortages.map(s => 
          `${s.materialName}：需要 ${s.required}${s.unit}，库存仅 ${s.available}${s.unit}，缺口 ${s.shortage}${s.unit}`
        );
        msg += '：' + shortageMsgs.join('；');
      } else if (res.errors && res.errors.length) {
        msg += '：' + res.errors.map(e => e.message).join('；');
      }
      showAlert(msg, true);
      return;
    }

    showAlert('记录已添加，材料库存已自动扣减', false);
    try {
      availableMaterials = await api('/api/materials');
    } catch {}
    currentRecords = await api('/api/projects/' + currentProjectId + '/timeline');
    currentRecords = window.Timeline.mergeRecordsWithDrafts(currentRecords || []);
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

async function deleteRecord(recordId) {
  if (!confirm('确定要删除这条过程记录吗？相关材料库存将自动恢复。')) {
    return;
  }

  try {
    const res = await api('/api/projects/' + currentProjectId + '/timeline/' + recordId, {
      method: 'DELETE'
    });

    if (res.error) {
      showAlert(res.message || '删除失败', true);
      return;
    }

    showAlert('记录已删除，材料库存已恢复', false);
    try {
      availableMaterials = await api('/api/materials');
    } catch {}
    currentRecords = await api('/api/projects/' + currentProjectId + '/timeline');
    currentRecords = window.Timeline.mergeRecordsWithDrafts(currentRecords || []);
    renderList();

    if (typeof window.onTimelineUpdated === 'function') {
      window.onTimelineUpdated(currentProjectId, currentRecords);
    }
  } catch (error) {
    showAlert(error.message || '删除失败', true);
  }
}

function formatMaterialUsagesDisplay(record) {
  if (!record.materialUsages || !Array.isArray(record.materialUsages) || record.materialUsages.length === 0) {
    return '';
  }
  const parts = record.materialUsages.map(u => {
    const name = u.materialName || u.materialId;
    const unit = u.unit || '';
    return `${name} ${u.quantity}${unit}`;
  });
  return '<div class="timeline-item-row"><span class="tl-label">消耗材料</span><span class="tl-material-usage">' + escapeHtml(parts.join('、')) + '</span></div>';
}

function renderList() {
  const list = document.getElementById('timeline-list');
  if (!currentRecords || currentRecords.length === 0) {
    list.innerHTML = '<div class="timeline-empty-full">还没有过程记录，点击上方「新增过程记录」开始记录修复过程。</div>';
    return;
  }

  const admin = isAdmin();
  const sorted = [...currentRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  list.innerHTML = sorted.map((r, idx) => {
    const isSystem = r.type === "system";
    const isDraft = r._isDraft;
    return (
      '<div class="timeline-item ' + (isSystem ? 'system' : 'manual') + (isDraft ? ' draft-record' : '') + '">' +
        '<div class="timeline-item-line">' +
          '<span class="timeline-item-dot ' + (isSystem ? 'system' : 'manual') + (isDraft ? ' draft' : '') + '"></span>' +
          (idx < sorted.length - 1 ? '<span class="timeline-item-connector"></span>' : '') +
        '</div>' +
        '<div class="timeline-item-body">' +
          '<div class="timeline-item-head">' +
            (isSystem
              ? '<span class="timeline-badge system">系统</span> <b>' + escapeHtml(r.systemMessage || '状态变更') + '</b>'
              : '<span class="timeline-badge manual">人工</span> <b>' + escapeHtml(r.operator) + '</b>') +
            (isDraft ? '<span class="timeline-badge draft">本地草稿</span>' : '') +
            '<span class="timeline-item-date">' + escapeHtml(r.date) + '</span>' +
            (admin && !isSystem && !isDraft ? '<button class="timeline-delete-btn danger" data-delete="' + escapeHtml(r.id) + '">删除</button>' : '') +
          '</div>' +
          (isSystem ? '' :
            '<div class="timeline-item-row"><span class="tl-label">处理步骤</span><span>' + escapeHtml(r.steps) + '</span></div>' +
            formatMaterialUsagesDisplay(r) +
            (r.materials ? '<div class="timeline-item-row"><span class="tl-label">使用材料</span><span>' + escapeHtml(r.materials) + '</span></div>' : '') +
            (r.notes ? '<div class="timeline-item-row"><span class="tl-label">备注</span><span>' + escapeHtml(r.notes) + '</span></div>' : '') +
            (r.photoUrl ? '<div class="timeline-item-row"><span class="tl-label">照片</span><a href="' + escapeHtml(r.photoUrl) + '" target="_blank" rel="noopener">查看照片 →</a></div>' : '')
          ) +
        '</div>' +
      '</div>'
    );
  }).join('');

  list.querySelectorAll('button[data-delete]').forEach(btn => {
    btn.onclick = () => deleteRecord(btn.dataset.delete);
  });
}
