(function() {
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const FIELD_CONFIG = {
    steps: { label: "修复步骤", icon: "📝", description: "模板中的标准修复步骤" },
    materials: { label: "使用材料", icon: "📦", description: "建议使用的修复材料" },
    estimatedDays: { label: "预计工期", icon: "📅", description: "标准修复工期（天）" },
    reviewRequired: { label: "复核开关", icon: "✅", description: "是否需要完成复核流程" },
    reviewNotes: { label: "复核要点", icon: "📋", description: "复核时需要重点检查的内容" }
  };

  class TemplateDiffModal {
    constructor(container, options) {
      this.container = typeof container === "string" ? document.querySelector(container) : container;
      if (!this.container) throw new Error("TemplateDiffModal: container not found");
      this.modalWrapper = this.container.closest('#template-diff-modal') || this.container.parentElement;

      this.options = Object.assign({
        projectId: null,
        onSyncSuccess: null,
        onClose: null
      }, options || {});

      this.diffData = null;
      this.selectedFields = {};
      this.isLoading = false;
      this._isOpen = false;

      this._init();
    }

    _init() {
      this.container.classList.add("tdm-component");
      this.render();
    }

    isOpen() {
      return this._isOpen;
    }

    async open(projectId) {
      if (projectId) this.options.projectId = projectId;
      if (!this.options.projectId) {
        alert("缺少项目ID");
        return;
      }

      this._isOpen = true;
      this.isLoading = true;
      this.diffData = null;
      this.selectedFields = {};
      if (this.modalWrapper) this.modalWrapper.style.display = "flex";
      this.container.style.display = "flex";
      this.render();

      try {
        const res = await fetch("/api/projects/" + encodeURIComponent(this.options.projectId) + "/template-diff", {
          headers: this._getHeaders()
        });
        const data = await res.json();
        if (data.error) {
          alert("加载失败：" + (data.message || data.error));
          this.close();
          return;
        }
        this.diffData = data;
        if (data && data.fieldDifferences) {
          Object.keys(data.fieldDifferences).forEach(key => {
            this.selectedFields[key] = data.fieldDifferences[key].changed;
          });
        }
      } catch (e) {
        alert("加载失败：" + e.message);
        this.close();
        return;
      } finally {
        this.isLoading = false;
        this.render();
        this._bindEvents();
      }
    }

    close() {
      this._isOpen = false;
      this.container.style.display = "none";
      if (this.modalWrapper) this.modalWrapper.style.display = "none";
      if (typeof this.options.onClose === "function") {
        this.options.onClose();
      }
    }

    _getHeaders() {
      const viewer = document.querySelector("#viewer");
      const headers = { "Content-Type": "application/json" };
      if (viewer && viewer.value) headers["X-Viewer-Id"] = viewer.value;
      return headers;
    }

    render() {
      let html = '<div class="tdm-backdrop">';
      html += '<div class="tdm-modal">';

      if (this.isLoading) {
        html += this._buildLoading();
      } else if (!this.diffData) {
        html += this._buildEmpty();
      } else {
        html += this._buildContent();
      }

      html += '</div></div>';
      this.container.innerHTML = html;
    }

    _buildLoading() {
      return (
        '<div class="tdm-header"><h2>模板差异对比</h2><button class="tdm-close-btn">&times;</button></div>' +
        '<div class="tdm-body"><div class="tdm-loading">加载中...</div></div>'
      );
    }

    _buildEmpty() {
      return (
        '<div class="tdm-header"><h2>模板差异对比</h2><button class="tdm-close-btn">&times;</button></div>' +
        '<div class="tdm-body"><div class="tdm-empty">无差异数据</div></div>'
      );
    }

    _buildContent() {
      const d = this.diffData;
      const header = this._buildHeader(d);
      const body = this._buildBody(d);
      const footer = this._buildFooter(d);
      return header + body + footer;
    }

    _buildHeader(d) {
      let html = '<div class="tdm-header">';
      html += '<div class="tdm-header-main">';
      html += '<h2>📋 模板差异对比</h2>';
      html += '<div class="tdm-subtitle">' + escapeHtml(d.templateName || "未知模板") + ' · ' + escapeHtml(d.templateCategory || "") + '</div>';
      html += '</div>';
      html += '<button class="tdm-close-btn">&times;</button>';
      html += '</div>';

      html += '<div class="tdm-version-bar">';
      html += '<div class="tdm-version old">';
      html += '<div class="tdm-version-label">项目快照版本</div>';
      html += '<div class="tdm-version-num">v' + d.snapshotVersion + '</div>';
      html += '<div class="tdm-version-date">应用于 ' + escapeHtml(d.appliedAt || "-") + '</div>';
      html += '</div>';
      html += '<div class="tdm-version-arrow">→</div>';
      html += '<div class="tdm-version new">';
      html += '<div class="tdm-version-label">最新模板版本</div>';
      html += '<div class="tdm-version-num">v' + d.currentVersion + '</div>';
      html += '<div class="tdm-version-date">' + (d.isNewer ? '<span class="tdm-new-badge">✨ 已更新</span>' : "") + '</div>';
      html += '</div>';
      html += '</div>';

      if (!d.hasChanges) {
        html += '<div class="tdm-no-changes">项目快照与最新模板完全一致，无需同步。</div>';
      } else {
        html += '<div class="tdm-change-summary">';
        html += '共检测到 <strong>' + d.changedFields.length + '</strong> 处差异，请选择需要同步的内容：';
        html += '</div>';
      }

      return html;
    }

    _buildBody(d) {
      let html = '<div class="tdm-body">';
      html += '<div class="tdm-field-list">';

      Object.keys(FIELD_CONFIG).forEach(key => {
        const config = FIELD_CONFIG[key];
        const diff = d.fieldDifferences[key];
        if (!diff) return;

        const classes = ["tdm-field"];
        if (diff.changed) classes.push("changed");
        if (this.selectedFields[key]) classes.push("selected");

        html += '<div class="' + classes.join(" ") + '" data-field="' + key + '">';
        html += '<div class="tdm-field-head">';
        html += '<label class="tdm-field-check">';
        html += '<input type="checkbox" data-field-checkbox="' + key + '"' + (diff.changed ? "" : " disabled") + (this.selectedFields[key] ? " checked" : "") + '>';
        html += '<span class="tdm-field-icon">' + config.icon + '</span>';
        html += '<span class="tdm-field-title">' + config.label + '</span>';
        html += '</label>';
        html += diff.changed ? '<span class="tdm-field-diff-tag">有变更</span>' : '<span class="tdm-field-no-tag">未变更</span>';
        html += '</div>';
        html += '<div class="tdm-field-desc">' + config.description + '</div>';
        html += '<div class="tdm-field-compare">';
        html += this._buildCompareCell(diff, key);
        html += '</div>';
        html += '</div>';
      });

      html += '</div></div>';
      return html;
    }

    _buildCompareCell(diff, key) {
      if (!diff.changed) {
        return (
          '<div class="tdm-compare-same">' +
            '<div class="tdm-compare-label">内容一致</div>' +
            '<pre class="tdm-compare-val">' + escapeHtml(this._formatValue(diff.oldValue, key)) + '</pre>' +
          '</div>'
        );
      }

      return (
        '<div class="tdm-compare-old">' +
          '<div class="tdm-compare-label">📌 项目快照 v' + (this.diffData?.snapshotVersion || 0) + '</div>' +
          '<pre class="tdm-compare-val old">' + escapeHtml(this._formatValue(diff.oldValue, key)) + '</pre>' +
        '</div>' +
        '<div class="tdm-compare-sep">➡️</div>' +
        '<div class="tdm-compare-new">' +
          '<div class="tdm-compare-label">🚀 最新模板 v' + (this.diffData?.currentVersion || 0) + '</div>' +
          '<pre class="tdm-compare-val new">' + escapeHtml(this._formatValue(diff.newValue, key)) + '</pre>' +
        '</div>'
      );
    }

    _formatValue(val, key) {
      if (key === "reviewRequired") {
        if (val === true || val !== false) return "需要复核";
        return "不需要复核";
      }
      if (key === "estimatedDays") {
        return (val || 0) + " 天";
      }
      if (val === null || val === undefined || val === "") {
        return "(空)";
      }
      return String(val);
    }

    _buildFooter(d) {
      const selectedCount = Object.values(this.selectedFields).filter(Boolean).length;
      const canSync = d.hasChanges && selectedCount > 0;

      let html = '<div class="tdm-footer">';
      html += '<div class="tdm-footer-left">';
      html += '<label class="tdm-select-all">';
      html += '<input type="checkbox" id="tdmSelectAll" ' + (selectedCount === (d?.changedFields?.length || 0) ? "checked" : "") + (d && d.hasChanges ? "" : " disabled") + '>';
      html += ' 选择所有差异项';
      html += '</label>';
      html += '</div>';
      html += '<div class="tdm-footer-right">';
      html += '<button type="button" class="tdm-btn secondary" id="tdmCancel">取消</button>';
      html += '<button type="button" class="tdm-btn" id="tdmSync" ' + (canSync ? "" : " disabled") + '>';
      html += '✨ 同步选中项到项目（' + selectedCount + ' 项）';
      html += '</button>';
      html += '</div></div>';
      return html;
    }

    _bindEvents() {
      const self = this;

      const closeBtn = this.container.querySelector(".tdm-close-btn");
      const cancelBtn = this.container.querySelector("#tdmCancel");
      const backdrop = this.container.querySelector(".tdm-backdrop");

      if (closeBtn) closeBtn.onclick = () => self.close();
      if (cancelBtn) cancelBtn.onclick = () => self.close();
      if (backdrop) {
        backdrop.onclick = (e) => {
          if (e.target === backdrop) self.close();
        };
      }

      this.container.querySelectorAll('[data-field-checkbox]').forEach(cb => {
        cb.onchange = () => {
          const field = cb.dataset.fieldCheckbox;
          self.selectedFields[field] = cb.checked;
          self._syncFieldSelection(field);
          self._updateFooterState();
        };
      });

      this.container.querySelectorAll('.tdm-field').forEach(fieldEl => {
        fieldEl.onclick = (e) => {
          if (e.target.closest("input")) return;
          const field = fieldEl.dataset.field;
          const cb = self.container.querySelector('[data-field-checkbox="' + field + '"]');
          if (cb && !cb.disabled) {
            cb.checked = !cb.checked;
            self.selectedFields[field] = cb.checked;
            self._syncFieldSelection(field);
            self._updateFooterState();
          }
        };
      });

      const selectAll = this.container.querySelector("#tdmSelectAll");
      if (selectAll) {
        selectAll.onchange = () => {
          const checked = selectAll.checked;
          Object.keys(self.selectedFields).forEach(key => {
            self.selectedFields[key] = checked && (self.diffData?.fieldDifferences?.[key]?.changed);
          });
          self.render();
          self._bindEvents();
        };
      }

      const syncBtn = this.container.querySelector("#tdmSync");
      if (syncBtn) {
        syncBtn.onclick = async () => await self._doSync();
      }
    }

    _syncFieldSelection(field) {
      const fieldEl = this.container.querySelector('.tdm-field[data-field="' + field + '"]');
      if (fieldEl) {
        fieldEl.classList.toggle("selected", !!this.selectedFields[field]);
      }
    }

    _updateFooterState() {
      const selectedCount = Object.values(this.selectedFields).filter(Boolean).length;
      const changedCount = this.diffData?.changedFields?.length || 0;

      const syncBtn = this.container.querySelector("#tdmSync");
      if (syncBtn) {
        syncBtn.disabled = selectedCount === 0;
        syncBtn.innerHTML = '✨ 同步选中项到项目（' + selectedCount + ' 项）';
      }

      const selectAll = this.container.querySelector("#tdmSelectAll");
      if (selectAll) {
        selectAll.checked = changedCount > 0 && selectedCount === changedCount;
      }
    }

    async _doSync() {
      const selectedCount = Object.values(this.selectedFields).filter(Boolean);
      if (selectedCount.length === 0) {
        alert("请至少选择一项要同步的内容");
        return;
      }

      const confirmMsg = [
        "确认同步以下更新到此项目？",
        "",
        "模板：" + (this.diffData?.templateName || ""),
        "版本：v" + (this.diffData?.snapshotVersion || 0) + " → v" + (this.diffData?.currentVersion || 0),
        "",
        "同步字段：",
      ];
      Object.keys(this.selectedFields).forEach(key => {
        if (this.selectedFields[key]) {
          confirmMsg.push("  · " + FIELD_CONFIG[key].label);
        }
      });
      confirmMsg.push("", "注意：原模板快照将保存在历史记录中。");

      if (!confirm(confirmMsg.join("\n"))) return;

      const syncBtn = this.container.querySelector("#tdmSync");
      if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.innerHTML = "同步中...";
      }

      try {
        const res = await fetch("/api/projects/" + encodeURIComponent(this.options.projectId) + "/sync-template", {
          method: "POST",
          headers: this._getHeaders(),
          body: JSON.stringify({ fields: this.selectedFields })
        });
        const data = await res.json();

        if (data.error) {
          alert("同步失败：" + (data.message || data.error));
          if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.innerHTML = '✨ 同步选中项到项目（' + Object.values(this.selectedFields).filter(Boolean).length + ' 项）';
          }
          return;
        }

        alert([
          "✅ 同步成功！",
          "",
          "模板版本：v" + (data.oldVersion || 0) + " → v" + (data.newVersion || 0),
          "已同步字段：",
          ...(Object.keys(data.syncedFields || {}).filter(k => data.syncedFields[k]).map(k => "  · " + FIELD_CONFIG[k].label))
        ].join("\n"));

        this.close();
        if (typeof this.options.onSyncSuccess === "function") {
          this.options.onSyncSuccess(data);
        }

      } catch (e) {
        alert("同步失败：" + e.message);
        if (syncBtn) {
          syncBtn.disabled = false;
          syncBtn.innerHTML = '✨ 同步选中项到项目（' + Object.values(this.selectedFields).filter(Boolean).length + ' 项）';
        }
      }
    }
  }

  window.TemplateDiffModal = TemplateDiffModal;
})();
