let auditProjectId = null;
let auditLogs = [];
let auditUser = null;
let auditSelectedLogId = null;
let auditRollbackPreview = null;

window.AuditLog = {
  setUser(user) {
    auditUser = user;
  },

  async open(project, users) {
    auditProjectId = project.id;
    if (users && users.length > 0) {
      const viewerEl = document.querySelector('#viewer');
      const viewerId = viewerEl ? viewerEl.value : '';
      const found = users.find(u => u.id === viewerId);
      if (found) {
        auditUser = found;
      } else if (!auditUser) {
        auditUser = users[0];
      }
    }
    auditSelectedLogId = null;
    auditRollbackPreview = null;
    try {
      auditLogs = await api('/api/projects/' + project.id + '/audit-logs');
    } catch {
      auditLogs = [];
    }
    showModal(project);
  }
};

function api(path, options) {
  const viewerEl = document.querySelector('#viewer');
  const viewerId = viewerEl ? viewerEl.value : '';
  const headers = { "Content-Type": "application/json" };
  if (viewerId) headers["X-Viewer-Id"] = viewerId;
  if (options && options.method && options.method !== "GET") {
    const dv = window.DataVersionConflictHandler ? window.DataVersionConflictHandler.getVersion() : null;
    if (dv !== null) headers["X-Data-Version"] = String(dv);
  }
  return fetch(path, options && options.body ? { ...options, headers } : (options ? { ...options, headers } : { headers }))
    .then(function(r) {
      if (window.DataVersionConflictHandler) window.DataVersionConflictHandler.extractVersionFromResponse(r);
      return r.json().then(function(data) {
        if (r.status === 409 && data.error === "data_version_conflict") {
          if (window.DataVersionConflictHandler) window.DataVersionConflictHandler.updateVersion(data.serverDataVersion);
          return { ...data, _dataVersionConflict: true };
        }
        return data;
      });
    });
}

function handleAuditConflict(errorData, options) {
  if (!window.DataVersionConflictHandler) {
    alert("数据已被其他操作修改，请刷新页面后重试。");
    location.reload();
    return;
  }
  window.DataVersionConflictHandler.handleConflict(errorData, {
    pageLabel: options && options.pageLabel ? options.pageLabel : "审计回滚",
    onReload: function() { location.reload(); },
    onSaveDraft: function(data) {
      return window.DataVersionConflictHandler.saveDraftToLocalStorage("audit_" + Date.now(), data, "审计回滚");
    },
    onRetry: options && options.onRetry ? options.onRetry : function() {}
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function getActionIcon(actionType) {
  const icons = {
    project_create: '➕',
    project_update: '✏️',
    status_change: '🔄',
    review_pass: '✅',
    review_reject: '❌',
    rollback: '↩️',
    template_sync: '🔗'
  };
  return icons[actionType] || '📝';
}

function getActionBadgeClass(actionType) {
  const classes = {
    project_create: 'create',
    project_update: 'update',
    status_change: 'status',
    review_pass: 'pass',
    review_reject: 'reject',
    rollback: 'rollback',
    template_sync: 'sync'
  };
  return classes[actionType] || 'default';
}

function showModal(project) {
  closeModal();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'audit-modal';
  modal.innerHTML =
    '<div class="modal-overlay" data-close="1"></div>' +
    '<div class="modal-content audit-modal-content">' +
      '<div class="modal-header">' +
        '<h3>操作审计历史 — ' + escapeHtml(project.title) + '</h3>' +
        '<button class="modal-close" data-close="1">×</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="audit-toolbar">' +
          '<span class="audit-count">共 ' + (auditLogs ? auditLogs.length : 0) + ' 条记录</span>' +
          (isAdmin() ? '<span class="audit-hint">💡 点击记录可查看详情，管理员可执行回滚</span>' : '<span class="audit-hint">💡 点击记录可查看详情</span>') +
        '</div>' +
        '<div class="audit-timeline" id="audit-timeline"></div>' +
        '<div id="audit-detail" class="audit-detail" style="display:none;"></div>' +
        '<div id="audit-rollback-preview" class="audit-rollback-preview" style="display:none;"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  modal.querySelectorAll('[data-close]').forEach(el => el.onclick = closeModal);
  renderTimeline();
}

function isAdmin() {
  return auditUser && auditUser.role === 'admin';
}

function closeModal() {
  const m = document.getElementById('audit-modal');
  if (m) m.remove();
}

function renderTimeline() {
  const list = document.getElementById('audit-timeline');
  if (!auditLogs || auditLogs.length === 0) {
    list.innerHTML = '<div class="audit-empty">暂无审计记录。</div>';
    return;
  }

  list.innerHTML = auditLogs.map((log, idx) => {
    const isSelected = auditSelectedLogId === log.id;
    const canRollback = isAdmin() && log.hasStateSnapshot && log.actionType !== 'rollback';
    let rollbackInfoHtml = '';
    if (log.actionType === 'rollback') {
      const meta = log.rollbackMeta;
      const targetInfo = log.rollbackTargetInfo;
      if (meta || targetInfo) {
        rollbackInfoHtml = '<div class="audit-rollback-info">';
        if (meta && meta.reason) {
          rollbackInfoHtml += '<div class="audit-rollback-reason-line">📝 回滚原因：' + escapeHtml(meta.reason) + '</div>';
        }
        if (targetInfo) {
          rollbackInfoHtml += '<div class="audit-rollback-target-line">🎯 回滚目标：' + escapeHtml(targetInfo.actionLabel) + '（' + escapeHtml(targetInfo.operator) + ' · ' + formatDateTime(targetInfo.timestamp) + '）</div>';
        }
        if (meta && meta.sourceLogAction && !targetInfo) {
          rollbackInfoHtml += '<div class="audit-rollback-target-line">🎯 回滚目标：' + escapeHtml(meta.sourceLogAction) + '（' + escapeHtml(meta.sourceLogOperator) + ' · ' + formatDateTime(meta.sourceLogTimestamp) + '）</div>';
        }
        rollbackInfoHtml += '</div>';
      }
    }
    return (
      '<div class="audit-item ' + (isSelected ? 'selected' : '') + '" data-log-id="' + escapeHtml(log.id) + '">' +
        '<div class="audit-item-line">' +
          '<span class="audit-item-dot ' + getActionBadgeClass(log.actionType) + '">' + getActionIcon(log.actionType) + '</span>' +
          (idx < auditLogs.length - 1 ? '<span class="audit-item-connector"></span>' : '') +
        '</div>' +
        '<div class="audit-item-body">' +
          '<div class="audit-item-head">' +
            '<span class="audit-badge ' + getActionBadgeClass(log.actionType) + '">' + escapeHtml(log.actionLabel) + '</span>' +
            '<span class="audit-item-operator">' + escapeHtml(log.operator) + '</span>' +
            '<span class="audit-item-time">' + formatDateTime(log.timestamp) + '</span>' +
            (canRollback ? '<span class="audit-rollable">可回滚</span>' : '') +
          '</div>' +
          '<div class="audit-item-summary">' + escapeHtml(log.summary) + '</div>' +
          (log.note ? '<div class="audit-item-note">📝 ' + escapeHtml(log.note) + '</div>' : '') +
          rollbackInfoHtml +
          '<div class="audit-item-source">来源：' + escapeHtml(log.source) + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  list.querySelectorAll('.audit-item').forEach(item => {
    item.onclick = () => {
      const logId = item.dataset.logId;
      auditSelectedLogId = logId;
      renderTimeline();
      showDetail(logId);
    };
  });
}

async function showDetail(logId) {
  const detailEl = document.getElementById('audit-detail');
  const rollbackEl = document.getElementById('audit-rollback-preview');

  try {
    const log = await api('/api/projects/' + auditProjectId + '/audit-logs/' + logId);
    if (!log || log.error) {
      detailEl.innerHTML = '<div class="audit-error">加载详情失败</div>';
      detailEl.style.display = 'block';
      rollbackEl.style.display = 'none';
      return;
    }

    let changesHtml = '';
    if (log.changes && log.changes.length > 0) {
      changesHtml = '<div class="audit-changes"><h4>变更详情</h4>';
      log.changes.forEach(change => {
        const typeLabel = change.type === 'add' ? '新增' : change.type === 'remove' ? '删除' : '修改';
        const typeClass = change.type === 'add' ? 'add' : change.type === 'remove' ? 'remove' : 'modify';
        const oldDisplay = typeof change.oldValue === 'object' ? JSON.stringify(change.oldValue) : (change.oldValue || '(空)');
        const newDisplay = typeof change.newValue === 'object' ? JSON.stringify(change.newValue) : (change.newValue || '(空)');
        changesHtml +=
          '<div class="audit-change-item">' +
            '<div class="audit-change-head">' +
              '<span class="audit-change-type ' + typeClass + '">' + typeLabel + '</span>' +
              '<span class="audit-change-field">' + escapeHtml(change.label) + '</span>' +
            '</div>' +
            '<div class="audit-change-values">' +
              '<div class="audit-change-old"><span class="label">变更前：</span><span class="value">' + escapeHtml(oldDisplay) + '</span></div>' +
              '<div class="audit-change-new"><span class="label">变更后：</span><span class="value">' + escapeHtml(newDisplay) + '</span></div>' +
            '</div>' +
          '</div>';
      });
      changesHtml += '</div>';
    }

    let rollbackMetaHtml = '';
    if (log.actionType === 'rollback' && log.rollbackMeta) {
      const meta = log.rollbackMeta;
      rollbackMetaHtml =
        '<div class="audit-changes"><h4>回滚元信息</h4>' +
          '<div class="info-row"><span class="info-label">回滚原因</span><span class="info-value">' + escapeHtml(meta.reason || '未填写') + '</span></div>' +
          '<div class="info-row"><span class="info-label">目标操作</span><span class="info-value">' + escapeHtml(meta.sourceLogAction || '-') + '</span></div>' +
          '<div class="info-row"><span class="info-label">目标操作人</span><span class="info-value">' + escapeHtml(meta.sourceLogOperator || '-') + '</span></div>' +
          '<div class="info-row"><span class="info-label">目标操作时间</span><span class="info-value">' + formatDateTime(meta.sourceLogTimestamp) + '</span></div>' +
        '</div>';
    }

    let rollbackBtnHtml = '';
    if (isAdmin() && log.afterState && log.actionType !== 'rollback') {
      rollbackBtnHtml =
        '<div class="audit-detail-actions">' +
          '<button class="danger" id="audit-rollback-btn" data-log-id="' + escapeHtml(log.id) + '">↩️ 回滚到此状态</button>' +
        '</div>';
    }

    detailEl.innerHTML =
      '<div class="audit-detail-card">' +
        '<div class="audit-detail-header">' +
          '<h4>操作详情</h4>' +
          '<span class="audit-detail-id">ID: ' + escapeHtml(log.id) + '</span>' +
        '</div>' +
        '<div class="audit-detail-info">' +
          '<div class="info-row"><span class="info-label">操作类型</span><span class="info-value">' + escapeHtml(log.actionLabel) + '</span></div>' +
          '<div class="info-row"><span class="info-label">操作人</span><span class="info-value">' + escapeHtml(log.operator) + '</span></div>' +
          '<div class="info-row"><span class="info-label">操作时间</span><span class="info-value">' + formatDateTime(log.timestamp) + '</span></div>' +
          '<div class="info-row"><span class="info-label">来源</span><span class="info-value">' + escapeHtml(log.source) + '</span></div>' +
          (log.note ? '<div class="info-row"><span class="info-label">备注</span><span class="info-value">' + escapeHtml(log.note) + '</span></div>' : '') +
        '</div>' +
        changesHtml +
        rollbackMetaHtml +
        rollbackBtnHtml +
      '</div>';

    detailEl.style.display = 'block';
    rollbackEl.style.display = 'none';

    const rollbackBtn = document.getElementById('audit-rollback-btn');
    if (rollbackBtn) {
      rollbackBtn.onclick = () => showRollbackPreview(log.id);
    }
  } catch (e) {
    detailEl.innerHTML = '<div class="audit-error">加载详情失败：' + escapeHtml(e.message) + '</div>';
    detailEl.style.display = 'block';
  }
}

function renderFieldChangesHtml(fieldChanges) {
  if (!fieldChanges || fieldChanges.length === 0) {
    return '<div class="audit-preview-section"><h5>📋 字段级变更</h5><div class="audit-no-change">无字段级变更</div></div>';
  }
  let html = '<div class="audit-preview-section"><h5>📋 字段级变更（' + fieldChanges.length + ' 项）</h5><div class="audit-field-changes">';
  fieldChanges.forEach(change => {
    const oldVal = typeof change.oldValue === 'object' ? JSON.stringify(change.oldValue) : (change.oldValue || '(空)');
    const newVal = typeof change.newValue === 'object' ? JSON.stringify(change.newValue) : (change.newValue || '(空)');
    html +=
      '<div class="audit-field-change-row">' +
        '<div class="audit-field-change-label">' + escapeHtml(change.label) + '</div>' +
        '<div class="audit-field-change-values">' +
          '<div class="audit-field-change-old"><span class="tag">当前</span>' + escapeHtml(oldVal) + '</div>' +
          '<div class="audit-field-change-arrow">→</div>' +
          '<div class="audit-field-change-new"><span class="tag target">回滚后</span>' + escapeHtml(newVal) + '</div>' +
        '</div>' +
      '</div>';
  });
  html += '</div></div>';
  return html;
}

function renderTemplateSnapshotHtml(preview) {
  const data = preview.templateSnapshot;
  if (!data) return '';
  const cur = data.current || {};
  const tgt = data.target || {};
  let html = '<div class="audit-preview-section ' + (data.willChange ? 'will-change' : 'no-change-section') + '">';
  html += '<h5>📄 模板快照' + (data.willChange ? ' <span class="change-tag">将变更</span>' : ' <span class="no-change-tag">无变更</span>') + '</h5>';
  html += '<div class="audit-compare-grid">';
  html += '<div class="audit-compare-col"><div class="col-title">当前</div>';
  if (cur.exists) {
    html +=
      '<div class="audit-template-info">' +
        '<div class="tpl-name">' + escapeHtml(cur.summary) + '</div>' +
        '<div class="tpl-meta">分类：' + escapeHtml(cur.templateCategory || '-') + '</div>' +
        '<div class="tpl-meta">应用日期：' + formatDate(cur.appliedAt) + '</div>' +
        '<div class="tpl-meta">预计工期：' + (cur.estimatedDays || 0) + ' 天</div>' +
        '<div class="tpl-meta">复核要求：' + (cur.reviewRequired ? '需要' : '不需要') + '</div>' +
      '</div>';
  } else {
    html += '<div class="audit-empty-line">无关联模板</div>';
  }
  html += '</div><div class="audit-compare-col"><div class="col-title target">回滚后</div>';
  if (tgt.exists) {
    html +=
      '<div class="audit-template-info">' +
        '<div class="tpl-name">' + escapeHtml(tgt.summary) + '</div>' +
        '<div class="tpl-meta">分类：' + escapeHtml(tgt.templateCategory || '-') + '</div>' +
        '<div class="tpl-meta">应用日期：' + formatDate(tgt.appliedAt) + '</div>' +
        '<div class="tpl-meta">预计工期：' + (tgt.estimatedDays || 0) + ' 天</div>' +
        '<div class="tpl-meta">复核要求：' + (tgt.reviewRequired ? '需要' : '不需要') + '</div>' +
      '</div>';
  } else {
    html += '<div class="audit-empty-line">无关联模板</div>';
  }
  html += '</div></div></div>';
  return html;
}

function renderReviewRecordsHtml(preview) {
  const data = preview.reviewRecords;
  if (!data) return '';
  const cur = data.current || { count: 0, items: [] };
  const tgt = data.target || { count: 0, items: [] };
  let html = '<div class="audit-preview-section ' + (data.willChange ? 'will-change' : 'no-change-section') + '">';
  html += '<h5>✅ 复核记录' + (data.willChange ? ' <span class="change-tag">将变更</span>' : ' <span class="no-change-tag">无变更</span>') + '</h5>';
  html += '<div class="audit-compare-grid">';

  function renderReviewList(items, count, isTarget) {
    let inner = '<div class="col-title ' + (isTarget ? 'target' : '') + '">' + (isTarget ? '回滚后' : '当前') + '（' + count + ' 条）</div>';
    if (!items || items.length === 0) {
      inner += '<div class="audit-empty-line">暂无复核记录</div>';
    } else {
      items.forEach(r => {
        const resultClass = r.result === 'pass' ? 'pass' : 'reject';
        inner +=
          '<div class="audit-review-item">' +
            '<div class="review-head">' +
              '<span class="review-index">#' + r.index + '</span>' +
              '<span class="review-result ' + resultClass + '">' + escapeHtml(r.resultLabel || r.result) + '</span>' +
              '<span class="review-reviewer">' + escapeHtml(r.reviewer) + '</span>' +
              '<span class="review-date">' + formatDate(r.date) + '</span>' +
            '</div>' +
            (r.opinion ? '<div class="review-opinion">' + escapeHtml(r.opinion) + '</div>' : '') +
          '</div>';
      });
    }
    return inner;
  }

  html += '<div class="audit-compare-col">' + renderReviewList(cur.items, cur.count, false) + '</div>';
  html += '<div class="audit-compare-col">' + renderReviewList(tgt.items, tgt.count, true) + '</div>';
  html += '</div></div>';
  return html;
}

function renderTimelineRecordsHtml(preview) {
  const data = preview.timelineRecords;
  if (!data) return '';
  const cur = data.current || { count: 0, items: [] };
  const tgt = data.target || { count: 0, items: [] };
  let html = '<div class="audit-preview-section ' + (data.willChange ? 'will-change' : 'no-change-section') + '">';
  html += '<h5>📅 时间线记录' + (data.willChange ? ' <span class="change-tag">将变更</span>' : ' <span class="no-change-tag">无变更</span>') + '</h5>';
  html += '<div class="audit-compare-grid">';

  function renderTimelineList(items, count, hasMore, isTarget) {
    let inner = '<div class="col-title ' + (isTarget ? 'target' : '') + '">' + (isTarget ? '回滚后' : '当前') + '（' + count + ' 条）</div>';
    if (!items || items.length === 0) {
      inner += '<div class="audit-empty-line">暂无时间线记录</div>';
    } else {
      items.forEach(t => {
        const typeClass = t.type === 'system' ? 'system' : 'manual';
        inner +=
          '<div class="audit-timeline-item">' +
            '<div class="tl-head">' +
              '<span class="tl-type ' + typeClass + '">' + escapeHtml(t.typeLabel || t.type) + '</span>' +
              '<span class="tl-operator">' + escapeHtml(t.operator || '-') + '</span>' +
              '<span class="tl-date">' + formatDate(t.date) + '</span>' +
            '</div>' +
            '<div class="tl-content">' + escapeHtml(t.systemMessage || t.steps || '-') + '</div>' +
          '</div>';
      });
      if (hasMore) {
        inner += '<div class="tl-more-hint">... 还有更多记录</div>';
      }
    }
    return inner;
  }

  html += '<div class="audit-compare-col">' + renderTimelineList(cur.items, cur.count, cur.hasMore, false) + '</div>';
  html += '<div class="audit-compare-col">' + renderTimelineList(tgt.items, tgt.count, tgt.hasMore, true) + '</div>';
  html += '</div></div>';
  return html;
}

function renderPhotoArchiveHtml(preview) {
  const data = preview.photoArchive;
  if (!data) return '';
  const cur = data.current || { before: 0, during: 0, after: 0, total: 0 };
  const tgt = data.target || { before: 0, during: 0, after: 0, total: 0 };
  let html = '<div class="audit-preview-section ' + (data.willChange ? 'will-change' : 'no-change-section') + '">';
  html += '<h5>📷 照片归档摘要' + (data.willChange ? ' <span class="change-tag">将变更</span>' : ' <span class="no-change-tag">无变更</span>') + '</h5>';
  html += '<div class="audit-photo-compare">';

  function renderPhotoStage(label, before, during, after, total, isTarget) {
    let inner = '<div class="photo-col ' + (isTarget ? 'target' : '') + '"><div class="col-title ' + (isTarget ? 'target' : '') + '">' + (isTarget ? '回滚后' : '当前') + '</div>';
    inner += '<div class="photo-total">共 ' + total + ' 张</div>';
    inner += '<div class="photo-stage-row">';
    inner += '<span class="photo-stage before">修复前 ' + before + ' 张</span>';
    inner += '<span class="photo-stage during">修复中 ' + during + ' 张</span>';
    inner += '<span class="photo-stage after">修复后 ' + after + ' 张</span>';
    inner += '</div></div>';
    return inner;
  }

  html += renderPhotoStage('', cur.before, cur.during, cur.after, cur.total, false);
  html += renderPhotoStage('', tgt.before, tgt.during, tgt.after, tgt.total, true);
  html += '</div></div>';
  return html;
}

async function showRollbackPreview(targetLogId) {
  const rollbackEl = document.getElementById('audit-rollback-preview');

  try {
    const preview = await api('/api/projects/' + auditProjectId + '/rollback-preview', {
      method: 'POST',
      body: JSON.stringify({ targetLogId })
    });

    if (preview.error) {
      rollbackEl.innerHTML = '<div class="audit-error">' + escapeHtml(preview.message || '回滚预览失败') + '</div>';
      rollbackEl.style.display = 'block';
      return;
    }

    auditRollbackPreview = preview;

    let sectionsHtml = '';
    sectionsHtml += renderFieldChangesHtml(preview.fieldChanges);
    sectionsHtml += renderTemplateSnapshotHtml(preview);
    sectionsHtml += renderReviewRecordsHtml(preview);
    sectionsHtml += renderTimelineRecordsHtml(preview);
    sectionsHtml += renderPhotoArchiveHtml(preview);

    const canExecute = preview.hasChanges;

    rollbackEl.innerHTML =
      '<div class="audit-rollback-card">' +
        '<div class="audit-rollback-header">' +
          '<h4>⚠️ 回滚确认</h4>' +
          '<span class="rollback-target-badge">目标操作</span>' +
        '</div>' +
        '<div class="audit-rollback-info">' +
          '<div class="info-row"><span class="info-label">目标操作</span><span class="info-value">' + escapeHtml(preview.targetAction) + '</span></div>' +
          '<div class="info-row"><span class="info-label">操作人</span><span class="info-value">' + escapeHtml(preview.targetOperator) + '</span></div>' +
          '<div class="info-row"><span class="info-label">操作时间</span><span class="info-value">' + formatDateTime(preview.targetTimestamp) + '</span></div>' +
        '</div>' +
        '<div class="audit-preview-sections">' + sectionsHtml + '</div>' +
        '<div class="audit-rollback-reason">' +
          '<label class="required">回滚原因 <span class="req-mark">*</span></label>' +
          '<textarea id="rollback-reason" placeholder="请填写回滚原因（至少 5 个字符），此原因将记录在审计日志中" rows="3"></textarea>' +
          '<div class="reason-error" id="rollback-reason-error" style="display:none;color:#a84b2f;font-size:12px;margin-top:4px;"></div>' +
        '</div>' +
        '<div class="audit-rollback-actions">' +
          '<button class="secondary" id="cancel-rollback-btn">取消</button>' +
          '<button class="danger" id="confirm-rollback-btn" ' + (canExecute ? '' : 'disabled') + '>确认回滚</button>' +
        '</div>' +
        '<div class="audit-rollback-warning">⚠️ 警告：回滚操作不可撤销，回滚本身也会被记录到审计日志中。</div>' +
      '</div>';

    rollbackEl.style.display = 'block';
    rollbackEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.getElementById('cancel-rollback-btn').onclick = () => {
      rollbackEl.style.display = 'none';
      auditRollbackPreview = null;
    };

    if (canExecute) {
      document.getElementById('confirm-rollback-btn').onclick = confirmRollback;
    }
  } catch (e) {
    rollbackEl.innerHTML = '<div class="audit-error">加载回滚预览失败：' + escapeHtml(e.message) + '</div>';
    rollbackEl.style.display = 'block';
  }
}

async function confirmRollback() {
  if (!auditRollbackPreview) return;

  const reasonEl = document.getElementById('rollback-reason');
  const reasonErrorEl = document.getElementById('rollback-reason-error');
  const reason = (reasonEl?.value || '').trim();

  if (!reason) {
    reasonErrorEl.textContent = '请填写回滚原因';
    reasonErrorEl.style.display = 'block';
    reasonEl?.focus();
    return;
  }

  if (reason.length < 5) {
    reasonErrorEl.textContent = '回滚原因至少需要 5 个字符';
    reasonErrorEl.style.display = 'block';
    reasonEl?.focus();
    return;
  }

  reasonErrorEl.style.display = 'none';

  const confirmBtn = document.getElementById('confirm-rollback-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '回滚中...';
  }

  try {
    const result = await api('/api/projects/' + auditProjectId + '/rollback', {
      method: 'POST',
      body: JSON.stringify({
        targetLogId: auditRollbackPreview.targetLogId,
        reason: reason
      })
    });

    if (result._dataVersionConflict) {
      handleAuditConflict(result, {
        pageLabel: "审计回滚",
        onRetry: async function() {
          try {
            auditLogs = await api('/api/projects/' + auditProjectId + '/audit-logs');
            const retryResult = await api('/api/projects/' + auditProjectId + '/rollback', {
              method: 'POST',
              body: JSON.stringify({
                targetLogId: auditRollbackPreview.targetLogId,
                reason: reason
              })
            });
            if (!retryResult._dataVersionConflict && !retryResult.error) {
              alert('回滚成功！');
              auditLogs = await api('/api/projects/' + auditProjectId + '/audit-logs');
              auditSelectedLogId = null;
              auditRollbackPreview = null;
              const countEl = document.querySelector('.audit-count');
              if (countEl) countEl.textContent = '共 ' + auditLogs.length + ' 条记录';
              renderTimeline();
              document.getElementById('audit-detail').style.display = 'none';
              document.getElementById('audit-rollback-preview').style.display = 'none';
              if (typeof window.onAuditRollback === 'function') {
                window.onAuditRollback(auditProjectId);
              }
            } else if (retryResult.error) {
              alert('回滚失败：' + (retryResult.message || retryResult.error));
            }
          } catch (e) {
            alert('重试失败：' + e.message);
          } finally {
            if (confirmBtn) {
              confirmBtn.disabled = false;
              confirmBtn.textContent = '确认回滚';
            }
          }
        }
      });
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认回滚';
      }
      return;
    }

    if (result.error) {
      alert('回滚失败：' + (result.message || result.error));
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认回滚';
      }
      return;
    }

    alert('回滚成功！');

    auditLogs = await api('/api/projects/' + auditProjectId + '/audit-logs');
    auditSelectedLogId = null;
    auditRollbackPreview = null;

    const countEl = document.querySelector('.audit-count');
    if (countEl) countEl.textContent = '共 ' + auditLogs.length + ' 条记录';

    renderTimeline();
    document.getElementById('audit-detail').style.display = 'none';
    document.getElementById('audit-rollback-preview').style.display = 'none';

    if (typeof window.onAuditRollback === 'function') {
      window.onAuditRollback(auditProjectId);
    }
  } catch (e) {
    alert('回滚失败：' + e.message);
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认回滚';
    }
  }
}
