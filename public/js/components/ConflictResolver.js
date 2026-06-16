function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const FIELD_LABELS = {
  title: '藏品名称',
  era: '年代',
  damage: '破损类型',
  steps: '修复步骤',
  materials: '使用材料',
  owner: '负责人',
  dueDate: '预计完成日期',
  status: '状态',
  photos: '照片链接',
  operator: '操作人',
  date: '日期',
  notes: '备注',
  photoUrl: '照片链接'
};

class ConflictResolver {
  constructor(container, options = {}) {
    this.container = container;
    this.conflict = options.conflict || null;
    this.queueItemId = options.queueItemId || null;
    this.draftId = options.draftId || null;
    this.onResolved = options.onResolved || (() => {});
    this.onCancel = options.onCancel || (() => {});
    this.resolutions = {};
  }

  setConflict(conflict, queueItemId, draftId) {
    this.conflict = conflict;
    this.queueItemId = queueItemId;
    this.draftId = draftId || null;
    this.resolutions = {};
    this.photoResolution = 'merge';
    this.render();
  }

  render() {
    if (!this.conflict) {
      this.container.innerHTML = '<div class="conflict-empty">暂无冲突需要处理</div>';
      return;
    }

    const c = this.conflict;
    
    if (c.type === 'photos') {
      this.renderPhotosConflict(c);
      return;
    }

    const typeLabel = c.type === 'project' ? '项目信息' : '过程记录';
    const entityTitle = c.localSnapshot?.title || c.localSnapshot?.steps || '未命名';

    let html = `
      <div class="conflict-modal">
        <div class="conflict-header">
          <h3>⚠️ 同步冲突检测</h3>
          <button class="conflict-close" data-action="cancel">×</button>
        </div>
        <div class="conflict-summary">
          <p><strong>${typeLabel}：</strong>${escapeHtml(entityTitle)}</p>
          <p><strong>版本差异：</strong>本地草稿基于版本 v${c.baseVersion}，服务端当前版本 v${c.serverVersion}</p>
          <p class="conflict-hint">检测到 ${c.conflicts.length} 个字段存在冲突，请选择保留哪个版本：</p>
        </div>
        <div class="conflict-actions-top">
          <button class="secondary" data-action="keep-all-local">全部保留本地版本</button>
          <button class="secondary" data-action="keep-all-server">全部保留服务端版本</button>
        </div>
        <div class="conflict-fields">
          ${c.conflicts.map((fieldConflict, idx) => this.renderFieldConflict(fieldConflict, idx)).join('')}
        </div>
        <div class="conflict-actions">
          <button class="secondary" data-action="cancel">取消</button>
          <button class="conflict-submit" data-action="resolve">确认并同步</button>
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  renderPhotosConflict(c) {
    const stageLabels = { before: '修复前', during: '修复中', after: '修复后' };
    const stage = stageLabels[c.stage] || c.stage;
    const op = c.operation === 'add' ? '添加' : '删除';
    const currentResolution = this.photoResolution || 'merge';

    const serverPhotos = c.serverSnapshot?.photos || [];
    const localOp = c.localSnapshot || {};

    let html = `
      <div class="conflict-modal">
        <div class="conflict-header">
          <h3>⚠️ 照片同步冲突</h3>
          <button class="conflict-close" data-action="cancel">×</button>
        </div>
        <div class="conflict-summary">
          <p><strong>操作类型：</strong>${op}${stage}照片</p>
          <p><strong>冲突原因：</strong>${this.getConflictTypeText(c.conflictType)}</p>
          <p class="conflict-hint">服务端照片列表已发生变化，请选择处理方式：</p>
        </div>
        <div class="conflict-photo-options">
          <label class="conflict-option ${currentResolution === 'local' ? 'selected' : ''}">
            <input type="radio" name="photo-resolution" value="local" ${currentResolution === 'local' ? 'checked' : ''}>
            <div class="conflict-option-content">
              <div class="conflict-option-title">📝 保留本地操作</div>
              <div class="conflict-option-desc">强制执行本地的${op}操作，可能覆盖服务端的变化</div>
            </div>
          </label>
          <label class="conflict-option ${currentResolution === 'server' ? 'selected' : ''}">
            <input type="radio" name="photo-resolution" value="server" ${currentResolution === 'server' ? 'checked' : ''}>
            <div class="conflict-option-content">
              <div class="conflict-option-title">☁️ 保留服务端</div>
              <div class="conflict-option-desc">放弃本地操作，使用服务端的照片列表</div>
            </div>
          </label>
          <label class="conflict-option ${currentResolution === 'merge' ? 'selected' : ''}">
            <input type="radio" name="photo-resolution" value="merge" ${currentResolution === 'merge' ? 'checked' : ''}>
            <div class="conflict-option-content">
              <div class="conflict-option-title">🔀 合并照片列表（推荐）</div>
              <div class="conflict-option-desc">智能合并本地和服务端的照片，去重保留全部</div>
            </div>
          </label>
        </div>
        <div class="conflict-photo-preview">
          <div class="conflict-preview-section">
            <h4>📋 本地操作</h4>
            <div class="conflict-preview-content">
              <p><strong>操作：</strong>${op}</p>
              ${localOp.url ? `<p><strong>照片链接：</strong><code>${escapeHtml(localOp.url)}</code></p>` : ''}
              ${localOp.index !== undefined ? `<p><strong>照片索引：</strong>第 ${localOp.index + 1} 张</p>` : ''}
            </div>
          </div>
          <div class="conflict-preview-section">
            <h4>☁️ 服务端当前 (${serverPhotos.length} 张)</h4>
            <div class="conflict-preview-content conflict-photo-list">
              ${serverPhotos.length === 0 ? '<p>暂无照片</p>' : 
                serverPhotos.map((url, i) => `<div class="conflict-photo-item"><span class="conflict-photo-index">${i + 1}.</span><code>${escapeHtml(url)}</code></div>`).join('')
              }
            </div>
          </div>
        </div>
        <div class="conflict-actions">
          <button class="secondary" data-action="cancel">取消</button>
          <button class="conflict-submit" data-action="resolve-photo">确认并同步</button>
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.bindPhotoConflictEvents();
  }

  getConflictTypeText(type) {
    const typeMap = {
      'duplicate': '服务端已存在相同的照片',
      'index_out_of_range': '要删除的照片在服务端不存在',
      'list_changed': '服务端照片列表已发生变化'
    };
    return typeMap[type] || '照片列表存在差异';
  }

  bindPhotoConflictEvents() {
    const self = this;

    this.container.querySelectorAll('input[name="photo-resolution"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        self.photoResolution = e.target.value;
        self.container.querySelectorAll('.conflict-option').forEach(opt => {
          opt.classList.remove('selected');
        });
        e.target.closest('.conflict-option').classList.add('selected');
      });
    });

    this.container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        if (action === 'cancel') {
          self.onCancel();
        } else if (action === 'resolve-photo') {
          self.resolvePhoto();
        }
      });
    });
  }

  async resolvePhoto() {
    const resolution = this.photoResolution || 'merge';
    const submitBtn = this.container.querySelector('[data-action="resolve-photo"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '同步中...';
    submitBtn.disabled = true;

    try {
      const result = await SyncManager.executeSync(this.queueItemId, resolution, null);
      if (result.success) {
        SyncManager.removeFromSyncQueue(this.queueItemId);
        if (this.draftId) {
          SyncManager.deleteDraft(this.draftId);
        }
        SyncManager.notifyDraftsChanged();
        this.onResolved({
          success: true,
          resolution,
          entity: result.entity,
          type: 'photos'
        });
      } else {
        alert(`同步失败：${result.error || '未知错误'}`);
      }
    } catch (error) {
      alert(`同步失败：${error.message}`);
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  }

  renderFieldConflict(fieldConflict, idx) {
    const field = fieldConflict.field;
    const label = FIELD_LABELS[field] || field;
    const localValue = fieldConflict.localValue;
    const serverValue = fieldConflict.serverValue;
    const currentResolution = this.resolutions[field] || 'local';

    const localChecked = currentResolution === 'local' ? 'checked' : '';
    const serverChecked = currentResolution === 'server' ? 'checked' : '';

    const isMultiLine = field === 'steps' || field === 'materials' || field === 'notes';
    const displayLocal = isMultiLine
      ? `<pre>${escapeHtml(localValue || '(空)')}</pre>`
      : escapeHtml(localValue || '(空)');
    const displayServer = isMultiLine
      ? `<pre>${escapeHtml(serverValue || '(空)')}</pre>`
      : escapeHtml(serverValue || '(空)');

    return `
      <div class="conflict-field" data-field="${field}">
        <div class="conflict-field-header">
          <h4>${escapeHtml(label)}</h4>
          <div class="conflict-field-options">
            <label>
              <input type="radio" name="conflict-${field}" value="local" ${localChecked}>
              保留本地
            </label>
            <label>
              <input type="radio" name="conflict-${field}" value="server" ${serverChecked}>
              保留服务端
            </label>
          </div>
        </div>
        <div class="conflict-field-values">
          <div class="conflict-value-local ${currentResolution === 'local' ? 'selected' : ''}">
            <div class="conflict-value-label">📝 本地草稿</div>
            <div class="conflict-value-content">${displayLocal}</div>
          </div>
          <div class="conflict-value-server ${currentResolution === 'server' ? 'selected' : ''}">
            <div class="conflict-value-label">☁️ 服务端版本</div>
            <div class="conflict-value-content">${displayServer}</div>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.container.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const field = e.target.closest('.conflict-field').dataset.field;
        this.resolutions[field] = e.target.value;
        this.updateFieldSelection(field, e.target.value);
      });
    });

    this.container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        this.handleAction(action);
      });
    });
  }

  updateFieldSelection(field, value) {
    const fieldEl = this.container.querySelector(`.conflict-field[data-field="${field}"]`);
    if (!fieldEl) return;

    const localEl = fieldEl.querySelector('.conflict-value-local');
    const serverEl = fieldEl.querySelector('.conflict-value-server');

    localEl.classList.toggle('selected', value === 'local');
    serverEl.classList.toggle('selected', value === 'server');
  }

  handleAction(action) {
    switch (action) {
      case 'keep-all-local':
        this.conflict.conflicts.forEach(c => {
          this.resolutions[c.field] = 'local';
          const radio = this.container.querySelector(`input[name="conflict-${c.field}"][value="local"]`);
          if (radio) radio.checked = true;
          this.updateFieldSelection(c.field, 'local');
        });
        break;

      case 'keep-all-server':
        this.conflict.conflicts.forEach(c => {
          this.resolutions[c.field] = 'server';
          const radio = this.container.querySelector(`input[name="conflict-${c.field}"][value="server"]`);
          if (radio) radio.checked = true;
          this.updateFieldSelection(c.field, 'server');
        });
        break;

      case 'resolve':
        this.resolve();
        break;

      case 'cancel':
        this.onCancel();
        break;
    }
  }

  async resolve() {
    const unresolved = this.conflict.conflicts.filter(c => !this.resolutions[c.field]);
    if (unresolved.length > 0) {
      alert(`请为以下字段选择保留版本：${unresolved.map(c => FIELD_LABELS[c.field] || c.field).join('、')}`);
      return;
    }

    const allLocal = this.conflict.conflicts.every(c => this.resolutions[c.field] === 'local');
    const allServer = this.conflict.conflicts.every(c => this.resolutions[c.field] === 'server');

    let resolution, resolutionFields;
    if (allLocal) {
      resolution = 'local';
    } else if (allServer) {
      resolution = 'server';
    } else {
      resolution = 'custom';
      resolutionFields = { ...this.resolutions };
    }

    const submitBtn = this.container.querySelector('[data-action="resolve"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '同步中...';
    submitBtn.disabled = true;

    try {
      const result = await SyncManager.executeSync(this.queueItemId, resolution, resolutionFields);
      if (result.success) {
        SyncManager.removeFromSyncQueue(this.queueItemId);
        if (this.draftId) {
          SyncManager.deleteDraft(this.draftId);
        }
        SyncManager.notifyDraftsChanged();
        this.onResolved({
          success: true,
          resolution,
          resolutionFields,
          entity: result.entity
        });
      } else {
        alert(`同步失败：${result.error || '未知错误'}`);
      }
    } catch (error) {
      alert(`同步失败：${error.message}`);
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  }
}

window.ConflictResolver = ConflictResolver;
