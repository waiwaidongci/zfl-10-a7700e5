(function() {
  const STAGE_LABELS = { before: "修复前", during: "修复中", after: "修复后" };
  const STAGE_ORDER = ["before", "during", "after"];

  function sanitizeArchive(archive) {
    const result = { before: [], during: [], after: [] };
    STAGE_ORDER.forEach(function(stage) {
      const arr = (archive && archive[stage]) || [];
      result[stage] = arr.filter(function(url) {
        return typeof url === "string" && url.trim() !== "";
      });
    });
    return result;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function isUrlValid(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  class PhotosGallery {
    constructor(container, options) {
      this.container = typeof container === "string" ? document.querySelector(container) : container;
      if (!this.container) throw new Error("PhotosGallery: container not found");

      this.options = Object.assign({
        projectId: null,
        archive: { before: [], during: [], after: [] },
        editable: true,
        onUpdate: null,
        onLightbox: null
      }, options || {});

      this.archive = sanitizeArchive(this.options.archive);
      this.projectId = this.options.projectId;
      this._init();
    }

    _init() {
      this.container.classList.add("pg-component");
      this.render();
    }

    setArchive(archive) {
      this.archive = sanitizeArchive(archive);
      this.render();
    }

    getArchive() {
      return JSON.parse(JSON.stringify(this.archive));
    }

    _api(path, opts) {
      if (!this.projectId) return Promise.reject(new Error("No projectId"));
      if (window.SyncManager) {
        return window.SyncManager.api(path, opts);
      }
      const viewerEl = document.querySelector("#viewer");
      const viewerId = viewerEl ? viewerEl.value : "";
      const headers = { "Content-Type": "application/json" };
      if (viewerId) headers["X-Viewer-Id"] = viewerId;
      if (opts && opts.method && opts.method !== "GET") {
        const dv = window.DataVersionConflictHandler ? window.DataVersionConflictHandler.getVersion() : null;
        if (dv !== null) headers["X-Data-Version"] = String(dv);
      }
      const self = this;
      return fetch(path, opts && opts.body ? Object.assign({}, opts, { headers }) : (opts ? Object.assign({}, opts, { headers }) : { headers }))
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

    _handleConflict(errorData, options) {
      if (!window.DataVersionConflictHandler) {
        alert("数据已被其他操作修改，请刷新页面后重试。");
        location.reload();
        return;
      }
      const self = this;
      window.DataVersionConflictHandler.handleConflict(errorData, {
        pageLabel: options && options.pageLabel ? options.pageLabel : "照片",
        onReload: function() { location.reload(); },
        onSaveDraft: function(data) {
          return window.DataVersionConflictHandler.saveDraftToLocalStorage("pg_" + Date.now(), data, "照片");
        },
        onRetry: options && options.onRetry ? options.onRetry : function() {}
      });
    }

    render() {
      const html = this._buildHtml();
      this.container.innerHTML = html;
      this._bindEvents();
      this._bindImageHandlers();
    }

    _buildHtml() {
      let html = '<div class="pg-stages">';
      STAGE_ORDER.forEach(function(stage) {
        const photos = this.archive[stage] || [];
        html += '<div class="pg-stage">';
        html += '<div class="pg-stage-header">';
        html += '<span class="pg-stage-label ' + stage + '">' + STAGE_LABELS[stage] + '</span>';
        html += '<span class="pg-stage-count">' + photos.length + ' 张</span>';
        html += '</div>';
        html += '<div class="pg-stage-grid" data-stage="' + stage + '">';

        if (photos.length === 0) {
          html += '<div class="pg-empty">';
          html += '<div class="pg-empty-icon">📷</div>';
          html += '<div>暂无' + STAGE_LABELS[stage] + '照片</div>';
          html += '</div>';
        } else {
          photos.forEach(function(url, index) {
            html += this._buildPhotoCard(stage, url, index, photos.length);
          }.bind(this));
        }

        html += '</div>';
        if (this.options.editable) {
          html += '<div class="pg-add-row">';
          html += '<input class="pg-add-input" data-stage="' + stage + '" placeholder="输入照片链接 URL" />';
          html += '<button class="pg-add-btn" data-stage="' + stage + '">添加</button>';
          html += '</div>';
        }
        html += '</div>';
      }.bind(this));
      html += '</div>';
      return html;
    }

    _buildPhotoCard(stage, url, index, total) {
      return (
        '<div class="pg-card" data-stage="' + stage + '" data-index="' + index + '">' +
          '<div class="pg-img-wrap pg-clickable" data-url="' + escapeHtml(url) + '" data-alt="' + STAGE_LABELS[stage] + '照片 ' + (index + 1) + '">' +
            '<img src="' + escapeHtml(url) + '" alt="' + STAGE_LABELS[stage] + '照片 ' + (index + 1) + '" loading="lazy">' +
            '<div class="pg-fallback"><span>图片加载失败</span></div>' +
            '<div class="pg-zoom-hint">🔍 点击放大</div>' +
          '</div>' +
          '<div class="pg-card-footer">' +
            '<span class="pg-card-index">' + (index + 1) + '/' + total + '</span>' +
            (this.options.editable ? '<button class="pg-delete-btn" data-stage="' + stage + '" data-index="' + index + '" title="删除照片">&times;</button>' : '') +
          '</div>' +
        '</div>'
      );
    }

    _bindEvents() {
      const self = this;

      this.container.querySelectorAll(".pg-delete-btn").forEach(function(btn) {
        btn.onclick = function(e) {
          e.stopPropagation();
          self.deletePhoto(btn.dataset.stage, parseInt(btn.dataset.index, 10));
        };
      });

      this.container.querySelectorAll(".pg-add-btn").forEach(function(btn) {
        btn.onclick = function() {
          const stage = btn.dataset.stage;
          const input = self.container.querySelector('.pg-add-input[data-stage="' + stage + '"]');
          if (!input) return;
          self.addPhoto(stage, input.value.trim());
        };
      });

      this.container.querySelectorAll(".pg-add-input").forEach(function(input) {
        input.onkeydown = function(e) {
          if (e.key === "Enter") {
            e.preventDefault();
            const stage = input.dataset.stage;
            self.addPhoto(stage, input.value.trim());
          }
        };
      });
    }

    _bindImageHandlers() {
      const self = this;

      this.container.querySelectorAll(".pg-img-wrap img").forEach(function(img) {
        img.onerror = function() {
          this.style.display = "none";
          const wrap = this.parentNode;
          const fallback = wrap.querySelector(".pg-fallback");
          if (fallback) fallback.style.display = "flex";
          const hint = wrap.querySelector(".pg-zoom-hint");
          if (hint) hint.style.display = "none";
          wrap.classList.remove("pg-clickable");
          wrap.onclick = null;
        };
      });

      this.container.querySelectorAll(".pg-clickable").forEach(function(wrap) {
        wrap.onclick = function() {
          const fallback = wrap.querySelector(".pg-fallback");
          if (fallback && fallback.style.display === "flex") return;
          const url = wrap.dataset.url;
          const alt = wrap.dataset.alt;
          if (typeof self.options.onLightbox === "function") {
            self.options.onLightbox(url, alt);
          } else if (window.PhotoLightbox) {
            window.PhotoLightbox.open(url, alt);
          }
        };
      });
    }

    async addPhoto(stage, url) {
      if (!url) return;
      if (!isUrlValid(url)) {
        const input = this.container.querySelector('.pg-add-input[data-stage="' + stage + '"]');
        if (input) {
          input.style.borderColor = "var(--warn)";
          setTimeout(function() { if (input) input.style.borderColor = ""; }, 2000);
        }
        return;
      }

      if (this.projectId) {
        try {
          const res = await this._api("/api/projects/" + this.projectId + "/photos", {
            method: "POST",
            body: JSON.stringify({ stage: stage, url: url, basePhotoCount: (this.archive[stage] || []).length, basePhotoList: [...(this.archive[stage] || [])] })
          });
          if (res._dataVersionConflict) {
            const self = this;
            this._handleConflict(res, {
              pageLabel: "添加照片",
              onRetry: async function() {
                try {
                  const refreshRes = await self._api("/api/projects/" + self.projectId + "/photos");
                  if (!refreshRes.error) {
                    self.archive = sanitizeArchive(refreshRes);
                    const retryRes = await self._api("/api/projects/" + self.projectId + "/photos", {
                      method: "POST",
                      body: JSON.stringify({ stage: stage, url: url, basePhotoCount: (self.archive[stage] || []).length, basePhotoList: [...(self.archive[stage] || [])] })
                    });
                    if (!retryRes._dataVersionConflict && !retryRes.error) {
                      self.archive = sanitizeArchive(retryRes);
                      const input = self.container.querySelector('.pg-add-input[data-stage="' + stage + '"]');
                      if (input) input.value = "";
                      self.render();
                      self._notifyUpdate();
                    } else if (retryRes.error) {
                      alert(retryRes.message || "添加失败");
                    }
                  }
                } catch (e) {
                  alert("重试失败: " + e.message);
                }
              }
            });
            return;
          }
          if (res.error) {
            alert(res.message || "添加失败");
            return;
          }
          if (res._savedAsDraft) {
            if (!this.archive[stage]) this.archive[stage] = [];
            this.archive[stage].push(url);
            alert("网络不可用，照片已保存为本地草稿。恢复连接后可在同步管理中手动同步。");
          } else {
            this.archive = sanitizeArchive(res);
          }
        } catch (e) {
          alert("添加失败: " + e.message);
          return;
        }
      } else {
        this.archive[stage].push(url);
      }

      const input = this.container.querySelector('.pg-add-input[data-stage="' + stage + '"]');
      if (input) input.value = "";
      this.render();
      this._notifyUpdate();
    }

    async deletePhoto(stage, index) {
      if (!confirm("确定删除这张" + STAGE_LABELS[stage] + "照片吗？")) return;

      const url = this.archive[stage] && this.archive[stage][index];

      if (this.projectId) {
        try {
          const res = await this._api("/api/projects/" + this.projectId + "/photos", {
            method: "DELETE",
            body: JSON.stringify({ stage: stage, index: index, url: url, basePhotoCount: (this.archive[stage] || []).length, basePhotoList: [...(this.archive[stage] || [])] })
          });
          if (res._dataVersionConflict) {
            const self = this;
            this._handleConflict(res, {
              pageLabel: "删除照片",
              onRetry: async function() {
                try {
                  const refreshRes = await self._api("/api/projects/" + self.projectId + "/photos");
                  if (!refreshRes.error) {
                    self.archive = sanitizeArchive(refreshRes);
                    const retryRes = await self._api("/api/projects/" + self.projectId + "/photos", {
                      method: "DELETE",
                      body: JSON.stringify({ stage: stage, index: index, url: url, basePhotoCount: (self.archive[stage] || []).length, basePhotoList: [...(self.archive[stage] || [])] })
                    });
                    if (!retryRes._dataVersionConflict && !retryRes.error) {
                      self.archive = sanitizeArchive(retryRes);
                      self.render();
                      self._notifyUpdate();
                      return true;
                    } else if (retryRes.error) {
                      alert(retryRes.message || "删除失败");
                    }
                  }
                } catch (e) {
                  alert("删除失败: " + e.message);
                }
                return false;
              }
            });
            return;
          }
          if (res.error) {
            alert(res.message || "删除失败");
            return;
          }
          if (res._savedAsDraft) {
            if (this.archive[stage] && index >= 0 && index < this.archive[stage].length) {
              this.archive[stage].splice(index, 1);
            }
            alert("网络不可用，删除操作已保存为本地草稿。恢复连接后可在同步管理中手动同步。");
          } else {
            this.archive = sanitizeArchive(res);
          }
        } catch (e) {
          alert("删除失败: " + e.message);
          return;
        }
      } else {
        this.archive[stage].splice(index, 1);
      }

      this.render();
      this._notifyUpdate();
    }

    _notifyUpdate() {
      if (typeof this.options.onUpdate === "function") {
        this.options.onUpdate(this.getArchive());
      }
    }
  }

  PhotosGallery.STAGE_LABELS = STAGE_LABELS;
  PhotosGallery.STAGE_ORDER = STAGE_ORDER;
  PhotosGallery.sanitizeArchive = sanitizeArchive;
  PhotosGallery.escapeHtml = escapeHtml;

  window.PhotosGallery = PhotosGallery;
})();
