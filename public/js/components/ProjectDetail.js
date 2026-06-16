(function() {
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function sanitizeArchive(archive) {
    const result = { before: [], during: [], after: [] };
    ["before", "during", "after"].forEach(function(stage) {
      const arr = (archive && archive[stage]) || [];
      result[stage] = arr.filter(function(url) {
        return typeof url === "string" && url.trim() !== "";
      });
    });
    return result;
  }

  function statusClass(s) {
    if (s === "待复核") return "pending";
    if (s === "已完成") return "done";
    return "active";
  }

  function isOverdue(project) {
    return project.status !== "已完成" && new Date(project.dueDate) < new Date(new Date().toISOString().slice(0, 10));
  }

  function getPhotoCount(archive) {
    const a = sanitizeArchive(archive);
    return a.before.length + a.during.length + a.after.length;
  }

  class ProjectDetail {
    constructor(container, options) {
      this.container = typeof container === "string" ? document.querySelector(container) : container;
      if (!this.container) throw new Error("ProjectDetail: container not found");

      this.options = Object.assign({
        project: null,
        users: [],
        editable: true,
        isAdmin: false,
        onStatusChange: null,
        onOpenPhotos: null,
        onOpenTimeline: null,
        onOpenReview: null,
        onOpenAudit: null,
        onOpenTemplateDiff: null,
        onClose: null
      }, options || {});

      this.project = this.options.project;
      this.users = this.options.users;
      this._galleryInstance = null;
      this._compareInstance = null;
      this._currentView = "compare";
      this._templateStatus = null;
      this._init();
    }

    _init() {
      this.container.classList.add("pd-component");
      this.render();
    }

    setProject(project) {
      this.project = project;
      this._galleryInstance = null;
      this._compareInstance = null;
      this.render();
    }

    getProject() {
      return this.project;
    }

    render() {
      if (!this.project) {
        this.container.innerHTML = this._buildEmpty();
        return;
      }
      const html = this._buildLayout();
      this.container.innerHTML = html;
      this._bindEvents();
      this._initPhotoComponents();
      this._checkTemplateStatus();
    }

    _buildEmpty() {
      return (
        '<div class="pd-empty">' +
          '<div class="pd-empty-icon">📋</div>' +
          '<div>未选择项目</div>' +
        '</div>'
      );
    }

    _buildLayout() {
      const p = this.project;
      const overdue = isOverdue(p);
      const photoCount = getPhotoCount(p.photoArchive);
      const latest = this._getLatestTimeline();
      const reviewRecords = p.reviewRecords || [];
      const lastReview = reviewRecords.length > 0 ? reviewRecords[reviewRecords.length - 1] : null;

      let html = '<div class="pd-layout">';

      html += '<div class="pd-header">';
      html += '<div class="pd-header-left">';
      html += '<h2 class="pd-title">' + escapeHtml(p.title) + '</h2>';
      html += '<div class="pd-meta">';
      html += '<span class="pd-meta-id">' + escapeHtml(p.id) + '</span>';
      html += '<span class="pd-meta-era">' + escapeHtml(p.era) + '</span>';
      html += '<span class="pd-meta-owner">' + escapeHtml(p.owner) + ' 负责</span>';
      html += '<span class="pd-meta-date">截止 ' + escapeHtml(p.dueDate) + '</span>';
      html += '</div>';
      html += '</div>';
      html += '<div class="pd-header-right">';
      html += '<span class="pd-pill ' + statusClass(p.status) + '">' + escapeHtml(p.status) + '</span>';
      if (overdue) html += '<span class="pd-danger">已逾期</span>';
      if (this.options.editable && typeof this.options.onStatusChange === "function") {
        html += '<select class="pd-status-select" data-id="' + escapeHtml(p.id) + '">';
        html += '<option' + (p.status === "进行中" ? " selected" : "") + '>进行中</option>';
        html += '<option' + (p.status === "待复核" ? " selected" : "") + '>待复核</option>';
        html += '<option' + (p.status === "已完成" ? " selected" : "") + '>已完成</option>';
        html += '</select>';
      }
      html += '</div>';
      html += '</div>';

      var lastRejection = null;
      for (var ri = reviewRecords.length - 1; ri >= 0; ri--) {
        if (reviewRecords[ri].result === "退回") {
          lastRejection = reviewRecords[ri];
          break;
        }
      }
      if (lastRejection) {
        html += '<div class="pd-rejection-banner">' +
          '<div class="pd-rejection-icon">⚠️</div>' +
          '<div class="pd-rejection-body">' +
            '<div class="pd-rejection-title">最近退回原因</div>' +
            '<div class="pd-rejection-meta">' + escapeHtml(lastRejection.reviewer) + ' · ' + escapeHtml(lastRejection.reviewedAt) + '</div>' +
            '<div class="pd-rejection-opinion">' + escapeHtml(lastRejection.opinion) + '</div>' +
          '</div>' +
        '</div>';
      }

      html += '<div class="pd-info-grid">';
      html += this._buildInfoCard("破损情况", p.damage, "🔬");
      html += this._buildInfoCard("修复步骤", p.steps, "📝");
      html += this._buildInfoCard("使用材料", p.materials, "📦");
      if (p.templateSnapshot) {
        html += this._buildTemplateSnapshotCard(p.templateSnapshot);
      }
      if (lastReview) {
        html += this._buildHtmlInfoCard(
          "最近复核",
          '<div class="pd-review-head">' +
            '<span class="pd-reviewer">' + escapeHtml(lastReview.reviewer) + '</span>' +
            '<span class="pd-review-date">' + escapeHtml(lastReview.reviewedAt) + '</span>' +
            '<span class="pd-review-result ' + (lastReview.result === "通过" ? "pass" : "reject") + '">' + escapeHtml(lastReview.result) + '</span>' +
          '</div>' +
          '<div class="pd-review-opinion">' + escapeHtml(lastReview.opinion) + '</div>',
          "✅"
        );
      }
      html += '</div>';

      html += '<div class="pd-section">';
      html += '<div class="pd-section-header">';
      html += '<h3 class="pd-section-title">照片归档与对比</h3>';
      html += '<div class="pd-section-actions">';
      html += '<div class="pd-view-toggle">';
      html += '<button class="pd-view-btn' + (this._currentView === "compare" ? " active" : "") + '" data-view="compare">对比视图</button>';
      html += '<button class="pd-view-btn' + (this._currentView === "gallery" ? " active" : "") + '" data-view="gallery">图库管理</button>';
      html += '</div>';
      if (photoCount > 0) {
        html += '<span class="pd-photo-count">共 ' + photoCount + ' 张照片</span>';
      }
      html += '</div>';
      html += '</div>';
      html += '<div class="pd-photo-container" id="pd-photo-container"></div>';
      html += '</div>';

      html += '<div class="pd-section">';
      html += '<div class="pd-section-header">';
      html += '<h3 class="pd-section-title">过程时间线</h3>';
      html += '<div class="pd-section-actions">';
      if (typeof this.options.onOpenAudit === "function") {
        html += '<button class="pd-link-btn" data-action="audit">📜 操作审计 →</button>';
      }
      if (typeof this.options.onOpenTimeline === "function") {
        html += '<button class="pd-link-btn" data-action="timeline">查看完整时间线 →</button>';
      }
      html += '</div>';
      html += '</div>';
      html += '<div class="pd-timeline">';
      if (latest) {
        html += this._buildTimelineItem(latest);
      } else {
        html += '<div class="pd-timeline-empty">暂无过程记录</div>';
      }
      html += '</div>';
      html += '</div>';

      html += '</div>';
      return html;
    }

    _buildInfoCard(label, value, icon) {
      return (
        '<div class="pd-info-card">' +
          '<div class="pd-info-label">' +
            '<span class="pd-info-icon">' + icon + '</span>' +
            escapeHtml(label) +
          '</div>' +
          '<div class="pd-info-value">' + escapeHtml(value) + '</div>' +
        '</div>'
      );
    }

    _buildHtmlInfoCard(label, htmlValue, icon) {
      return (
        '<div class="pd-info-card">' +
          '<div class="pd-info-label">' +
            '<span class="pd-info-icon">' + icon + '</span>' +
            escapeHtml(label) +
          '</div>' +
          '<div class="pd-info-value">' + htmlValue + '</div>' +
        '</div>'
      );
    }

    _buildTemplateSnapshotCard(snapshot) {
      if (!snapshot) return '';
      const ts = this._templateStatus;
      let html = '<div class="pd-snapshot-head" style="margin-bottom:6px;">';
      html += '<span class="pd-snapshot-name">' + escapeHtml(snapshot.templateName || '未知模板') + '</span>';
      html += '<span class="pd-snapshot-version">v' + (snapshot.templateVersion || 1) + '</span>';
      if (ts && ts.templateDeleted) {
        html += '<span class="pd-snapshot-del-badge" title="关联模板已被删除">🗑️ 模板已删除</span>';
      } else if (ts && ts.hasChanges) {
        html += '<span class="pd-snapshot-update-badge" title="检测到模板有更新">🔔 模板已更新</span>';
      }
      html += '</div>';
      html += '<div class="pd-snapshot-meta">';
      html += '<span>类型：' + escapeHtml(snapshot.templateCategory || '-') + '</span>';
      html += '<span>应用于：' + escapeHtml(snapshot.appliedAt || '-') + '</span>';
      html += '</div>';
      if (snapshot.estimatedDays) {
        html += '<div class="pd-snapshot-meta"><span>预计工期：' + snapshot.estimatedDays + '天</span></div>';
      }
      if (snapshot.reviewRequired !== undefined) {
        html += '<div class="pd-snapshot-meta"><span>复核：' + (snapshot.reviewRequired ? '需要' : '不需要') + '</span></div>';
      }
      if (snapshot.reviewNotes) {
        html += '<div class="pd-snapshot-notes" style="margin-top:6px;padding-top:6px;border-top:1px dashed #e0dcd2;font-size:12px;color:#6b6258;"><b>复核要求：</b>' + escapeHtml(snapshot.reviewNotes) + '</div>';
      }
      if (ts && ts.hasChanges && !ts.templateDeleted) {
        html += '<div class="pd-snapshot-upgrade-banner" id="pd-snapshot-upgrade">';
        html += '<div class="pd-snapshot-upgrade-icon">✨</div>';
        html += '<div class="pd-snapshot-upgrade-body">';
        html += '<div class="pd-snapshot-upgrade-title">模板已更新至 v' + ts.currentVersion + '</div>';
        html += '<div class="pd-snapshot-upgrade-meta">共 ' + (ts.changedFields ? ts.changedFields.length : (ts.changedCount || '若干')) + ' 处差异</div>';
        html += '</div>';
        if (this.options.isAdmin && typeof this.options.onOpenTemplateDiff === "function") {
          html += '<button class="pd-snapshot-upgrade-btn" data-action="template-diff">查看差异 →</button>';
        } else if (!this.options.isAdmin) {
          html += '<span class="pd-snapshot-upgrade-hint">联系管理员同步</span>';
        }
        html += '</div>';
      }
      if (!ts || (!ts.hasChanges && !ts.templateDeleted)) {
        html += '<div class="pd-snapshot-hint" style="margin-top:8px;font-size:11px;color:#8a8278;font-style:italic;">* 此为项目创建时的模板快照，可在模板更新后与最新版本同步</div>';
      }
      return this._buildHtmlInfoCard("应用模板", html, "📋");
    }

    async _checkTemplateStatus() {
      const p = this.project;
      if (!p || !p.templateSnapshot || !p.templateSnapshot.templateId || !p.id) return;

      try {
        const viewer = document.querySelector("#viewer");
        const headers = { "Content-Type": "application/json" };
        if (viewer && viewer.value) headers["X-Viewer-Id"] = viewer.value;

        const res = await fetch("/api/projects/" + encodeURIComponent(p.id) + "/template-status", { headers });
        const data = await res.json();
        if (data && !data.error) {
          this._templateStatus = data;
          this._refreshSnapshotCard();
        }
      } catch (e) {
        // 静默失败
      }
    }

    _refreshSnapshotCard() {
      const cardContainer = this.container.querySelector(".pd-info-card");
      if (!this.project || !this.project.templateSnapshot || !cardContainer) return;

      const allCards = this.container.querySelectorAll(".pd-info-card");
      let targetCard = null;
      allCards.forEach(function(c) {
        const labelEl = c.querySelector(".pd-info-label");
        if (labelEl && labelEl.textContent && labelEl.textContent.indexOf("应用模板") > -1) {
          targetCard = c;
        }
      });
      if (!targetCard) return;

      const valueEl = targetCard.querySelector(".pd-info-value");
      if (valueEl) {
        const newContent = this._buildTemplateSnapshotCard(this.project.templateSnapshot);
        const temp = document.createElement("div");
        temp.innerHTML = newContent;
        const newValueEl = temp.querySelector(".pd-info-value");
        if (newValueEl) {
          valueEl.innerHTML = newValueEl.innerHTML;
          this._bindSnapshotEvents(valueEl);
        }
      }
    }

    _bindSnapshotEvents(scope) {
      const self = this;
      scope = scope || this.container;
      const diffBtn = scope.querySelector('[data-action="template-diff"]');
      if (diffBtn && typeof this.options.onOpenTemplateDiff === "function") {
        diffBtn.onclick = function() {
          self.options.onOpenTemplateDiff(self.project);
        };
      }
    }

    _buildTimelineItem(record) {
      const isSystem = record.type === "system";
      const content = isSystem
        ? escapeHtml(record.systemMessage)
        : ('<b>' + escapeHtml(record.operator) + '</b>：' + escapeHtml(record.steps));

      return (
        '<div class="pd-tl-item' + (isSystem ? " system" : "") + '">' +
          '<span class="pd-tl-dot' + (isSystem ? " system" : "") + '"></span>' +
          '<div class="pd-tl-body">' +
            '<div class="pd-tl-content">' + content + '</div>' +
            '<div class="pd-tl-meta">' + escapeHtml(record.date) + '</div>' +
          '</div>' +
        '</div>'
      );
    }

    _getLatestTimeline() {
      const p = this.project;
      if (!p.timelineRecords || p.timelineRecords.length === 0) return null;
      return [...p.timelineRecords].sort(function(a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      })[0];
    }

    _bindEvents() {
      const self = this;

      const statusSelect = this.container.querySelector(".pd-status-select");
      if (statusSelect && typeof this.options.onStatusChange === "function") {
        statusSelect.onchange = function() {
          self.options.onStatusChange(self.project.id, statusSelect.value);
        };
      }

      this.container.querySelectorAll(".pd-view-btn").forEach(function(btn) {
        btn.onclick = function() {
          self._currentView = btn.dataset.view;
          self.container.querySelectorAll(".pd-view-btn").forEach(function(b) {
            b.classList.toggle("active", b === btn);
          });
          self._initPhotoComponents();
        };
      });

      const tlBtn = this.container.querySelector('[data-action="timeline"]');
      if (tlBtn && typeof this.options.onOpenTimeline === "function") {
        tlBtn.onclick = function() {
          self.options.onOpenTimeline(self.project);
        };
      }

      const auditBtn = this.container.querySelector('[data-action="audit"]');
      if (auditBtn && typeof this.options.onOpenAudit === "function") {
        auditBtn.onclick = function() {
          self.options.onOpenAudit(self.project);
        };
      }

      this._bindSnapshotEvents();
    }

    _initPhotoComponents() {
      const photoContainer = this.container.querySelector("#pd-photo-container");
      if (!photoContainer) return;

      const archive = sanitizeArchive(this.project ? this.project.photoArchive : null);
      const lightboxHandler = function(url, alt) {
        if (window.PhotoLightbox) {
          window.PhotoLightbox.open(url, alt);
        }
      };

      if (this._currentView === "compare") {
        if (window.PhotosCompare) {
          this._compareInstance = new window.PhotosCompare(photoContainer, {
            archive: archive,
            mode: "side-by-side",
            onLightbox: lightboxHandler
          });
        } else {
          photoContainer.innerHTML = '<div class="pd-error">PhotosCompare 组件未加载</div>';
        }
      } else {
        if (window.PhotosGallery) {
          this._galleryInstance = new window.PhotosGallery(photoContainer, {
            projectId: this.project ? this.project.id : null,
            archive: archive,
            editable: this.options.editable,
            onLightbox: lightboxHandler,
            onUpdate: function(newArchive) {
              if (self.project) {
                self.project.photoArchive = newArchive;
              }
            }
          });
        } else {
          photoContainer.innerHTML = '<div class="pd-error">PhotosGallery 组件未加载</div>';
        }
      }
    }

    updatePhotos() {
      this._initPhotoComponents();
    }
  }

  ProjectDetail.sanitizeArchive = sanitizeArchive;
  ProjectDetail.escapeHtml = escapeHtml;
  ProjectDetail.getPhotoCount = getPhotoCount;

  window.ProjectDetail = ProjectDetail;
})();
