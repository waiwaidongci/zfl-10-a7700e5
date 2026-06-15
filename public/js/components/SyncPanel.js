function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

class SyncPanel {
  constructor(container, options = {}) {
    this.container = container;
    this.onSyncComplete = options.onSyncComplete || (() => {});
    this.onConflict = options.onConflict || (() => {});
    this.conflictResolver = options.conflictResolver || null;
    this.drafts = [];
    this.queue = [];
    this.isOnline = navigator.onLine;

    this.init();
  }

  init() {
    this.refresh();
    SyncManager.onNetworkStatusChange(status => {
      this.isOnline = status;
      this.render();
    });
    SyncManager.onDraftsChange(() => {
      this.refresh();
    });
  }

  async refresh() {
    this.drafts = SyncManager.getDrafts();
    this.queue = SyncManager.getSyncQueue();
    this.render();
  }

  render() {
    const stats = SyncManager.getSyncStats();
    const statusIcon = this.isOnline ? '🟢' : '🔴';
    const statusText = this.isOnline ? '已连接' : '离线模式';

    let html = `
      <div class="sync-panel">
        <div class="sync-panel-header">
          <h3>
            <span class="sync-status-icon">${statusIcon}</span>
            同步管理
            <span class="sync-status-text">${statusText}</span>
          </h3>
          <div class="sync-stats">
            <span class="sync-stat">📝 草稿: ${stats.pendingDrafts}</span>
            <span class="sync-stat">⏳ 队列: ${stats.queuedItems}</span>
            ${stats.failedDrafts > 0 ? `<span class="sync-stat error">❌ 失败: ${stats.failedDrafts}</span>` : ''}
          </div>
        </div>
        ${this.renderActions()}
        ${this.renderDraftsList()}
      </div>
    `;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  renderActions() {
    const hasDrafts = this.drafts.length > 0;
    const hasQueue = this.queue.length > 0;
    const canSync = this.isOnline && (hasDrafts || hasQueue);

    return `
      <div class="sync-actions">
        <button class="secondary sync-action-btn" data-action="refresh" ${!this.isOnline ? 'disabled' : ''}>
          🔄 刷新状态
        </button>
        <button class="sync-action-btn" data-action="sync-all" ${!canSync ? 'disabled' : ''}>
          ⬆️ 同步全部草稿
        </button>
        <button class="secondary sync-action-btn" data-action="clear-local" ${!hasDrafts ? 'disabled' : ''}>
          🗑️ 清除本地草稿
        </button>
        <button class="secondary sync-action-btn" data-action="test-conflict">
          🧪 测试冲突场景
        </button>
      </div>
      <div id="sync-message" class="sync-message" style="display:none;"></div>
    `;
  }

  renderDraftsList() {
    if (this.drafts.length === 0) {
      return '<div class="sync-drafts-empty">暂无本地草稿</div>';
    }

    const draftsByType = {
      project: this.drafts.filter(d => d.type === 'project'),
      timeline: this.drafts.filter(d => d.type === 'timeline')
    };

    let html = '<div class="sync-drafts-list">';

    if (draftsByType.project.length > 0) {
      html += '<h4>📁 项目草稿</h4>';
      html += draftsByType.project.map(d => this.renderDraftItem(d)).join('');
    }

    if (draftsByType.timeline.length > 0) {
      html += '<h4>📋 过程记录草稿</h4>';
      html += draftsByType.timeline.map(d => this.renderDraftItem(d)).join('');
    }

    html += '</div>';
    return html;
  }

  renderDraftItem(draft) {
    const isQueued = this.queue.some(q => q.draftId === draft.id);
    const statusClass = draft.status === 'failed' ? 'failed' : (isQueued ? 'queued' : 'pending');
    const statusText = draft.status === 'failed' ? '同步失败' : (isQueued ? '等待同步' : '待同步');
    const title = draft.data?.title || draft.data?.steps || '未命名草稿';
    const timeAgo = this.getTimeAgo(draft.updatedAt);

    return `
      <div class="sync-draft-item ${statusClass}" data-draft-id="${draft.id}">
        <div class="sync-draft-main">
          <div class="sync-draft-title">${escapeHtml(title)}</div>
          <div class="sync-draft-meta">
            <span class="sync-draft-op">${draft.operation === 'create' ? '新建' : '更新'}</span>
            <span class="sync-draft-time">${timeAgo}</span>
            ${draft.lastSyncError ? `<span class="sync-draft-error" title="${escapeHtml(draft.lastSyncError)}">❌ ${escapeHtml(draft.lastSyncError.slice(0, 30))}…</span>` : ''}
          </div>
        </div>
        <div class="sync-draft-actions">
          ${!isQueued ? `
            <button class="secondary sync-draft-btn" data-action="sync" data-draft-id="${draft.id}" ${!this.isOnline ? 'disabled' : ''}>
              同步
            </button>
          ` : `<span class="sync-queued-badge">⏳ 队列中</span>`}
          <button class="secondary sync-draft-btn danger" data-action="delete" data-draft-id="${draft.id}">
            删除
          </button>
        </div>
      </div>
    `;
  }

  getTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
  }

  bindEvents() {
    this.container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.dataset.action;
        const draftId = btn.dataset.draftId;
        this.handleAction(action, draftId);
      });
    });
  }

  async handleAction(action, draftId) {
    switch (action) {
      case 'refresh':
        this.showMessage('正在刷新...', 'info');
        try {
          await SyncManager.getStatus();
          await this.refresh();
          this.showMessage('状态已更新', 'success');
        } catch (e) {
          this.showMessage('刷新失败: ' + e.message, 'error');
        }
        break;

      case 'sync-all':
        await this.syncAll();
        break;

      case 'sync':
        if (draftId) await this.syncSingle(draftId);
        break;

      case 'delete':
        if (draftId && confirm('确定要删除这个草稿吗？')) {
          SyncManager.deleteDraft(draftId);
          await this.refresh();
          this.showMessage('草稿已删除', 'success');
        }
        break;

      case 'clear-local':
        if (confirm('确定要清除所有本地草稿吗？此操作不可恢复。')) {
          const drafts = this.drafts.map(d => d.id);
          drafts.forEach(id => SyncManager.deleteDraft(id));
          await this.refresh();
          this.showMessage('已清除所有本地草稿', 'success');
        }
        break;

      case 'test-conflict':
        await this.testConflictScenario();
        break;
    }
  }

  async syncAll() {
    if (this.drafts.length === 0) {
      this.showMessage('没有需要同步的草稿', 'info');
      return;
    }

    this.showMessage('正在同步...', 'info');

    const draftIds = this.drafts.filter(d => !this.queue.some(q => q.draftId === d.id)).map(d => d.id);

    try {
      const results = await SyncManager.queueAndSync(draftIds);
      const conflicts = results.filter(r => r.status === 'conflict');
      const successes = results.filter(r => r.status === 'success');
      const failures = results.filter(r => r.status === 'failed');

      if (conflicts.length > 0) {
        this.showMessage(`检测到 ${conflicts.length} 个冲突，请处理`, 'warning');
        if (this.conflictResolver) {
          this.conflictResolver.setConflict(conflicts[0].conflict, conflicts[0].queueId);
        }
      } else if (successes.length > 0 && failures.length === 0) {
        this.showMessage(`成功同步 ${successes.length} 个草稿`, 'success');
      } else if (failures.length > 0) {
        this.showMessage(`同步完成：成功 ${successes.length} 个，失败 ${failures.length} 个`, 'error');
      }

      await this.refresh();
      this.onSyncComplete(results);
    } catch (e) {
      this.showMessage('同步失败: ' + e.message, 'error');
    }
  }

  async syncSingle(draftId) {
    try {
      const results = await SyncManager.queueAndSync([draftId]);
      const result = results[0];

      if (result?.status === 'conflict') {
        this.showMessage('检测到冲突，请处理', 'warning');
        if (this.conflictResolver) {
          this.conflictResolver.setConflict(result.conflict, result.queueId);
        }
      } else if (result?.status === 'success') {
        this.showMessage('同步成功', 'success');
      } else {
        this.showMessage('同步失败: ' + (result?.error || '未知错误'), 'error');
      }

      await this.refresh();
      this.onSyncComplete(results);
    } catch (e) {
      this.showMessage('同步失败: ' + e.message, 'error');
    }
  }

  async testConflictScenario() {
    const projects = await this.fetchProjects();
    if (projects.length === 0) {
      this.showMessage('没有可用的项目进行测试', 'error');
      return;
    }

    const testProject = projects[0];

    try {
      this.showMessage('正在制造冲突场景...', 'info');

      await SyncManager.saveProjectDraft({
        id: testProject.id,
        version: testProject.version,
        title: testProject.title + '（本地修改）',
        damage: '本地修改的破损描述'
      });

      const result = await SyncManager.simulateConflict(
        testProject.id,
        'damage',
        '服务端修改的破损描述'
      );

      this.showMessage('冲突场景已创建！点击"同步全部草稿"查看冲突处理界面', 'success');
      await this.refresh();
    } catch (e) {
      this.showMessage('创建测试场景失败: ' + e.message, 'error');
    }
  }

  async fetchProjects() {
    try {
      const res = await fetch('/api/projects');
      return await res.json();
    } catch (e) {
      return [];
    }
  }

  showMessage(text, type = 'info') {
    const el = this.container.querySelector('#sync-message');
    if (!el) return;
    el.className = `sync-message sync-message-${type}`;
    el.textContent = text;
    el.style.display = 'block';

    if (type !== 'warning') {
      setTimeout(() => {
        el.style.display = 'none';
      }, 3000);
    }
  }
}

window.SyncPanel = SyncPanel;
