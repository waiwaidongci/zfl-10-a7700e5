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
    auditUser = auditUser || (users && users[0]);
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
  return fetch(path, options && options.body ? { ...options, headers } : (options ? { ...options, headers } : { headers })).then(r => r.json());
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

function getActionIcon(actionType) {
  const icons = {
    project_create: '➕',
    project_update: '✏️',
    status_change: '🔄',
    review_pass: '✅',
    review_reject: '❌',
    rollback: '↩️'
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
    rollback: 'rollback'
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
          (isAdmin() ? '<span class="audit-hint">💡 点击记录可查看详情，管理员可执行回滚</span>' : '') +
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
        changesHtml +=
          '<div class="audit-change-item">' +
            '<div class="audit-change-head">' +
              '<span class="audit-change-type ' + typeClass + '">' + typeLabel + '</span>' +
              '<span class="audit-change-field">' + escapeHtml(change.label) + '</span>' +
            '</div>' +
            '<div class="audit-change-values">' +
              '<div class="audit-change-old"><span class="label">变更前：</span><span class="value">' + escapeHtml(change.oldValue || '(空)') + '</span></div>' +
              '<div class="audit-change-new"><span class="label">变更后：</span><span class="value">' + escapeHtml(change.newValue || '(空)') + '</span></div>' +
            '</div>' +
          '</div>';
      });
      changesHtml += '</div>';
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

    let changesHtml = '';
    if (preview.willChange && preview.willChange.length > 0) {
      changesHtml = '<div class="audit-changes"><h4>将回滚的变更</h4>';
      preview.willChange.forEach(change => {
        changesHtml +=
          '<div class="audit-change-item">' +
            '<div class="audit-change-head">' +
              '<span class="audit-change-field">' + escapeHtml(change.label) + '</span>' +
            '</div>' +
            '<div class="audit-change-values">' +
              '<div class="audit-change-old"><span class="label">当前值：</span><span class="value">' + escapeHtml(change.oldValue || '(空)') + '</span></div>' +
              '<div class="audit-change-new"><span class="label">将回滚为：</span><span class="value">' + escapeHtml(change.newValue || '(空)') + '</span></div>' +
            '</div>' +
          '</div>';
      });
      changesHtml += '</div>';
    } else {
      changesHtml = '<div class="audit-no-change">当前状态与目标状态一致，无需回滚。</div>';
    }

    const canExecute = preview.hasChanges;

    rollbackEl.innerHTML =
      '<div class="audit-rollback-card">' +
        '<div class="audit-rollback-header">' +
          '<h4>⚠️ 回滚确认</h4>' +
        '</div>' +
        '<div class="audit-rollback-info">' +
          '<div class="info-row"><span class="info-label">目标操作</span><span class="info-value">' + escapeHtml(preview.targetAction) + '</span></div>' +
          '<div class="info-row"><span class="info-label">操作人</span><span class="info-value">' + escapeHtml(preview.targetOperator) + '</span></div>' +
          '<div class="info-row"><span class="info-label">操作时间</span><span class="info-value">' + formatDateTime(preview.targetTimestamp) + '</span></div>' +
        '</div>' +
        changesHtml +
        '<div class="audit-rollback-reason">' +
          '<label>回滚原因（可选）</label>' +
          '<textarea id="rollback-reason" placeholder="请输入回滚原因，将记录到审计日志中"></textarea>' +
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

  const reason = document.getElementById('rollback-reason')?.value || '';

  try {
    const result = await api('/api/projects/' + auditProjectId + '/rollback', {
      method: 'POST',
      body: JSON.stringify({
        targetLogId: auditRollbackPreview.targetLogId,
        reason: reason.trim()
      })
    });

    if (result.error) {
      alert('回滚失败：' + (result.message || result.error));
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
  }
}
