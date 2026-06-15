const STORAGE_KEYS = {
  DRAFTS: 'restoration_drafts',
  SYNC_QUEUE: 'restoration_sync_queue',
  SERVER_STATE: 'restoration_server_state'
};

let isOnline = navigator.onLine;
let networkStatusListeners = [];

window.SyncManager = {
  init() {
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
    isOnline = navigator.onLine;
    this.notifyListeners(isOnline);
    this.loadState();
  },

  isOnline() {
    return isOnline;
  },

  onNetworkStatusChange(callback) {
    networkStatusListeners.push(callback);
    callback(isOnline);
  },

  notifyListeners(status) {
    networkStatusListeners.forEach(cb => cb(status));
  },

  handleOnline() {
    isOnline = true;
    this.notifyListeners(true);
    this.autoSyncIfNeeded().catch(e => console.warn('Auto-sync failed:', e));
  },

  handleOffline() {
    isOnline = false;
    this.notifyListeners(false);
  },

  async api(path, options) {
    const viewerEl = document.querySelector('#viewer');
    const viewerId = viewerEl ? viewerEl.value : '';
    const headers = { 'Content-Type': 'application/json' };
    if (viewerId) headers['X-Viewer-Id'] = viewerId;

    if (!isOnline && options && options.body) {
      const parsedBody = JSON.parse(options.body);
      if (options.allowOffline !== false) {
        return this.handleOfflineRequest(path, options, parsedBody);
      }
      throw new Error('网络不可用，请检查连接后重试');
    }

    try {
      const res = await fetch(path, { ...options, headers });
      const data = await res.json();

      if (res.status === 409 && (data.error === 'version_conflict' || data.error === 'conflict_detected')) {
        return { ...data, _conflictResponse: true };
      }

      if (!res.ok) {
        const err = new Error(data.message || data.error || '请求失败');
        err.error = data.error;
        err.data = data;
        throw err;
      }

      return data;
    } catch (error) {
      if (error.name === 'TypeError' || error.message.includes('Failed to fetch')) {
        isOnline = false;
        this.notifyListeners(false);

        if (options && options.body && options.allowOffline !== false) {
          const parsedBody = JSON.parse(options.body);
          return this.handleOfflineRequest(path, options, parsedBody);
        }
      }
      throw error;
    }
  },

  async handleOfflineRequest(path, options, body) {
    if (path === '/api/projects' && options.method === 'POST') {
      return this.saveProjectDraft(body);
    }
    if (path.startsWith('/api/projects/') && path.endsWith('/timeline') && options.method === 'POST') {
      const projectId = path.match(/\/api\/projects\/([^/]+)\/timeline/)[1];
      return this.saveTimelineDraft(projectId, body);
    }
    if (path.match(/^\/api\/projects\/[^/]+$/) && options.method === 'PATCH') {
      const projectId = path.match(/\/api\/projects\/([^/]+)/)[1];
      body.id = projectId;
      return this.saveProjectDraft(body);
    }
    throw new Error('网络不可用，且该操作不支持离线保存');
  },

  loadState() {
    try {
      const drafts = localStorage.getItem(STORAGE_KEYS.DRAFTS);
      const queue = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
      return {
        drafts: drafts ? JSON.parse(drafts) : [],
        syncQueue: queue ? JSON.parse(queue) : []
      };
    } catch (e) {
      console.warn('Failed to load sync state:', e);
      return { drafts: [], syncQueue: [] };
    }
  },

  saveState(state) {
    try {
      if (state.drafts !== undefined) {
        localStorage.setItem(STORAGE_KEYS.DRAFTS, JSON.stringify(state.drafts));
      }
      if (state.syncQueue !== undefined) {
        localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(state.syncQueue));
      }
    } catch (e) {
      console.error('Failed to save sync state:', e);
    }
  },

  getDrafts() {
    const state = this.loadState();
    return state.drafts;
  },

  getDraftById(draftId) {
    return this.getDrafts().find(d => d.id === draftId);
  },

  saveDraft(draft) {
    const state = this.loadState();
    const existing = state.drafts.find(d => d.id === draft.id);
    draft.updatedAt = new Date().toISOString();
    draft.status = draft.status || 'pending';

    if (existing) {
      Object.assign(existing, draft);
    } else {
      state.drafts.unshift(draft);
    }
    this.saveState(state);
    this.notifyDraftsChanged();
    return draft;
  },

  deleteDraft(draftId) {
    const state = this.loadState();
    state.drafts = state.drafts.filter(d => d.id !== draftId);
    state.syncQueue = state.syncQueue.filter(q => q.draftId !== draftId);
    this.saveState(state);
    this.notifyDraftsChanged();
  },

  async saveProjectDraft(projectData) {
    const draftId = `D-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const draft = {
      id: draftId,
      type: 'project',
      entityType: 'project',
      operation: projectData.id ? 'update' : 'create',
      entityId: projectData.id || null,
      data: { ...projectData },
      baseVersion: projectData.version || 1,
      createdBy: this.getCurrentUserId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending',
      syncAttempts: 0,
      lastSyncError: null,
      isLocal: true
    };

    this.saveDraft(draft);

    if (!projectData.id) {
      const tempProject = {
        ...projectData,
        id: draftId,
        version: 1,
        updatedAt: new Date().toISOString().slice(0, 10),
        status: projectData.status || '进行中',
        reviewRecords: [],
        timelineRecords: [],
        photoArchive: { before: [], during: [], after: [] },
        templateSnapshot: null,
        _isDraft: true,
        _draftId: draftId
      };
      return { ...tempProject, _savedAsDraft: true, draftId };
    }

    return { ...projectData, _savedAsDraft: true, draftId };
  },

  async saveTimelineDraft(projectId, timelineData) {
    const draftId = `D-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const draft = {
      id: draftId,
      type: 'timeline',
      entityType: 'timeline',
      operation: timelineData.id ? 'update' : 'create',
      entityId: timelineData.id || null,
      projectId,
      data: { ...timelineData },
      baseVersion: timelineData.version || 1,
      createdBy: this.getCurrentUserId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending',
      syncAttempts: 0,
      lastSyncError: null,
      isLocal: true
    };

    this.saveDraft(draft);

    const tempRecord = {
      ...timelineData,
      id: draftId,
      version: 1,
      createdAt: new Date().toISOString(),
      _isDraft: true,
      _draftId: draftId
    };

    return { project: {}, record: tempRecord, _savedAsDraft: true, draftId };
  },

  getCurrentUserId() {
    const viewerEl = document.querySelector('#viewer');
    return viewerEl ? viewerEl.value : '';
  },

  addToSyncQueue(draftIds) {
    const state = this.loadState();
    const results = [];

    for (const draftId of draftIds) {
      const draft = state.drafts.find(d => d.id === draftId);
      if (!draft) {
        results.push({ draftId, status: 'not_found' });
        continue;
      }

      const existing = state.syncQueue.find(q => q.draftId === draftId);
      if (existing) {
        results.push({ draftId, status: 'already_queued', queueId: existing.id });
        continue;
      }

      const queueItem = {
        id: `SQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        draftId,
        type: draft.type,
        entityType: draft.entityType,
        operation: draft.operation,
        entityId: draft.entityId,
        projectId: draft.projectId || null,
        data: draft.data,
        baseVersion: draft.baseVersion,
        createdBy: draft.createdBy,
        createdAt: new Date().toISOString(),
        status: 'pending',
        priority: Date.now()
      };

      state.syncQueue.push(queueItem);
      results.push({ draftId, status: 'queued', queueId: queueItem.id });
    }

    this.saveState(state);
    return results;
  },

  getSyncQueue() {
    const state = this.loadState();
    return state.syncQueue.sort((a, b) => a.priority - b.priority);
  },

  removeFromSyncQueue(queueItemId) {
    const state = this.loadState();
    state.syncQueue = state.syncQueue.filter(q => q.id !== queueItemId);
    this.saveState(state);
  },

  async detectConflicts(draftIds) {
    return await this.api('/api/sync/detect-conflicts', {
      method: 'POST',
      body: JSON.stringify({ draftIds }),
      allowOffline: false
    });
  },

  async executeSync(queueItemId, resolution, resolutionFields) {
    return await this.api('/api/sync/execute', {
      method: 'POST',
      body: JSON.stringify({ queueItemId, resolution, resolutionFields }),
      allowOffline: false
    });
  },

  async queueAndSync(draftIds) {
    const queueResults = this.addToSyncQueue(draftIds);
    const queued = queueResults.filter(r => r.status === 'queued');

    const results = [];
    for (const q of queued) {
      try {
        const result = await this.executeSync(q.queueId);
        if (result._conflictResponse) {
          results.push({
          queueId: q.queueId,
          draftId: q.draftId,
          status: 'conflict',
          conflict: result.conflict || result
          });
        } else if (result.success) {
          results.push({
          queueId: q.queueId,
          draftId: q.draftId,
          status: 'success',
          result
          });
          this.removeFromSyncQueue(q.queueId);
          this.deleteDraft(q.draftId);
        } else {
          results.push({
          queueId: q.queueId,
          draftId: q.draftId,
          status: 'failed',
          error: result.error || result.message || '同步失败'
          });
        }
      } catch (error) {
        results.push({
          queueId: q.queueId,
          draftId: q.draftId,
          status: 'failed',
          error: error.message
        });
      }
    }

    this.notifyDraftsChanged();
    return results;
  },

  async autoSyncIfNeeded() {
    const queue = this.getSyncQueue();
    if (queue.length === 0) return;

    const results = [];
    for (const item of queue) {
      try {
        const result = await this.executeSync(item.id);
        if (result._conflictResponse) {
          results.push({
            queueId: item.id,
            draftId: item.draftId,
            status: 'conflict',
            conflict: result.conflict || result
          });
        } else if (result.success) {
          results.push({
            queueId: item.id,
            draftId: item.draftId,
            status: 'success',
            result
          });
          this.removeFromSyncQueue(item.id);
          this.deleteDraft(item.draftId);
        } else {
          results.push({
            queueId: item.id,
            draftId: item.draftId,
            status: 'failed',
            error: result.error || '同步失败'
          });
        }
      } catch (error) {
        results.push({
          queueId: item.id,
          draftId: item.draftId,
          status: 'failed',
          error: error.message
        });
      }
    }

    this.notifyDraftsChanged();
    if (results.length > 0 && typeof this.onAutoSyncComplete === 'function') {
      this.onAutoSyncComplete(results);
    }

    return results;
  },

  async getStatus() {
    return await this.api('/api/sync/status', { method: 'GET', allowOffline: false });
  },

  async uploadDraft(draftId) {
    const draft = this.getDraftById(draftId);
    if (!draft) throw new Error('草稿不存在');

    return await this.api('/api/sync/drafts', {
      method: 'POST',
      body: JSON.stringify({
        type: draft.type,
        projectId: draft.projectId,
        data: draft.data
      }),
      allowOffline: false
    });
  },

  async uploadAllLocalDrafts() {
    const drafts = this.getDrafts().filter(d => d.isLocal);
    const results = [];

    for (const draft of drafts) {
      try {
        const result = await this.uploadDraft(draft.id);
        this.deleteDraft(draft.id);
        results.push({ draftId: draft.id, status: 'uploaded', result });
      } catch (error) {
        results.push({ draftId: draft.id, status: 'failed', error: error.message });
      }
    }

    return results;
  },

  async simulateConflict(projectId, field, value) {
    return await this.api('/api/sync/simulate-failure', {
      method: 'POST',
      body: JSON.stringify({ projectId, field, value }),
      allowOffline: false
    });
  },

  getSyncStats() {
    const state = this.loadState();
    return {
      totalDrafts: state.drafts.length,
      pendingDrafts: state.drafts.filter(d => d.status === 'pending').length,
      failedDrafts: state.drafts.filter(d => d.status === 'failed').length,
      queuedItems: state.syncQueue.length,
      isOnline
    };
  },

  onDraftsChange(callback) {
    if (!this._draftsListeners) this._draftsListeners = [];
    this._draftsListeners.push(callback);
  },

  notifyDraftsChanged() {
    if (this._draftsListeners) {
      const drafts = this.getDrafts();
      this._draftsListeners.forEach(cb => cb(drafts));
    }
  },

  mergeProjectsWithDrafts(projects) {
    const drafts = this.getDrafts().filter(d => d.type === 'project' && d.operation === 'create');
    const draftProjects = drafts.map(d => ({
      ...d.data,
      id: d.id,
      version: d.baseVersion,
      updatedAt: d.updatedAt.slice(0, 10),
      status: d.data.status || '进行中',
      reviewRecords: [],
      timelineRecords: [],
      photoArchive: { before: [], during: [], after: [] },
      templateSnapshot: null,
      _isDraft: true,
      _draftId: d.id
    }));
    return [...draftProjects, ...projects];
  }
};

SyncManager.init();
