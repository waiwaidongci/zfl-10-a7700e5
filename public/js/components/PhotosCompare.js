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

  class PhotosCompare {
    constructor(container, options) {
      this.container = typeof container === "string" ? document.querySelector(container) : container;
      if (!this.container) throw new Error("PhotosCompare: container not found");

      this.options = Object.assign({
        archive: { before: [], during: [], after: [] },
        mode: "side-by-side",
        onLightbox: null
      }, options || {});

      this.archive = sanitizeArchive(this.options.archive);
      this.mode = this.options.mode;
      this._init();
    }

    _init() {
      this.container.classList.add("pc-component");
      this.render();
    }

    setArchive(archive) {
      this.archive = sanitizeArchive(archive);
      this.render();
    }

    setMode(mode) {
      this.mode = mode;
      this.render();
    }

    render() {
      const hasAny = STAGE_ORDER.some(function(s) { return (this.archive[s] || []).length > 0; }.bind(this));
      let html;

      if (!hasAny) {
        html = this._buildEmpty();
      } else if (this.mode === "side-by-side") {
        html = this._buildSideBySide();
      } else {
        html = this._buildSideBySide();
      }

      this.container.innerHTML = html;
      this._bindImageHandlers();
    }

    _buildEmpty() {
      return (
        '<div class="pc-empty">' +
          '<div class="pc-empty-icon">📷</div>' +
          '<div>暂无照片，无法进行对比</div>' +
        '</div>'
      );
    }

    _buildSideBySide() {
      const maxLen = Math.max.apply(null, STAGE_ORDER.map(function(s) { return (this.archive[s] || []).length; }.bind(this)));

      let html = '<div class="pc-compare">';
      html += '<div class="pc-header-row">';
      STAGE_ORDER.forEach(function(stage) {
        const count = (this.archive[stage] || []).length;
        html += '<div class="pc-col-header ' + stage + '">' +
          STAGE_LABELS[stage] +
          '<span class="pc-col-count">(' + count + ' 张)</span>' +
        '</div>';
      }.bind(this));
      html += '</div>';

      for (let row = 0; row < maxLen; row++) {
        html += '<div class="pc-row">';
        STAGE_ORDER.forEach(function(stage) {
          const photos = this.archive[stage] || [];
          if (row < photos.length) {
            html += this._buildCell(stage, photos[row], row);
          } else {
            html += this._buildEmptyCell(stage);
          }
        }.bind(this));
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    _buildCell(stage, url, index) {
      const alt = STAGE_LABELS[stage] + '照片 ' + (index + 1);
      return (
        '<div class="pc-cell">' +
          '<div class="pc-img-wrap pc-clickable" data-url="' + escapeHtml(url) + '" data-alt="' + alt + '">' +
            '<img src="' + escapeHtml(url) + '" alt="' + alt + '" loading="lazy">' +
            '<div class="pc-fallback"><span>图片加载失败</span></div>' +
            '<div class="pc-zoom-hint">🔍</div>' +
          '</div>' +
          '<div class="pc-cell-label">' + STAGE_LABELS[stage] + ' ' + (index + 1) + '</div>' +
        '</div>'
      );
    }

    _buildEmptyCell(stage) {
      return (
        '<div class="pc-cell pc-cell-empty">' +
          '<div class="pc-placeholder">' +
            '<span>暂无' + STAGE_LABELS[stage] + '照片</span>' +
          '</div>' +
          '<div class="pc-cell-label">&mdash;</div>' +
        '</div>'
      );
    }

    _bindImageHandlers() {
      const self = this;

      this.container.querySelectorAll(".pc-img-wrap img").forEach(function(img) {
        img.onerror = function() {
          this.style.display = "none";
          const wrap = this.parentNode;
          const fallback = wrap.querySelector(".pc-fallback");
          if (fallback) fallback.style.display = "flex";
          const hint = wrap.querySelector(".pc-zoom-hint");
          if (hint) hint.style.display = "none";
          wrap.classList.remove("pc-clickable");
          wrap.onclick = null;
        };
      });

      this.container.querySelectorAll(".pc-clickable").forEach(function(wrap) {
        wrap.onclick = function() {
          const fallback = wrap.querySelector(".pc-fallback");
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
  }

  PhotosCompare.STAGE_LABELS = STAGE_LABELS;
  PhotosCompare.STAGE_ORDER = STAGE_ORDER;
  PhotosCompare.sanitizeArchive = sanitizeArchive;

  window.PhotosCompare = PhotosCompare;
})();
