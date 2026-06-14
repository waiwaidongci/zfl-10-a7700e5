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
        onStatusChange: null,
        onOpenPhotos: null,
        onOpenTimeline: null,
        onOpenReview: null,
        onClose: null
      }, options || {});

      this.project = this.options.project;
      this.users = this.options.users;
      this._galleryInstance = null;
      this._compareInstance = null;
      this._currentView = "compare";
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

      html += '<div class="pd-info-grid">';
      html += this._buildInfoCard("破损情况", p.damage, "🔬");
      html += this._buildInfoCard("修复步骤", p.steps, "📝");
      html += this._buildInfoCard("使用材料", p.materials, "📦");
      if (lastReview) {
        html += this._buildInfoCard(
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
