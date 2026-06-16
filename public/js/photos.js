(function() {
  let photosCurrentProjectId = null;
  let photosCurrentArchive = { before: [], during: [], after: [] };
  let photosCurrentView = "gallery";

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

  function photosApi(path, options) {
    if (window.SyncManager) {
      return window.SyncManager.api(path, options);
    }
    const viewerEl = document.querySelector("#viewer");
    const viewerId = viewerEl ? viewerEl.value : "";
    const headers = { "Content-Type": "application/json" };
    if (viewerId) headers["X-Viewer-Id"] = viewerId;
    return fetch(path, options && options.body ? { ...options, headers } : (options ? { ...options, headers } : { headers })).then(r => r.json());
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.Photos = {
    async open(project) {
      photosCurrentProjectId = project.id;
      photosCurrentView = "gallery";
      try {
        photosCurrentArchive = sanitizeArchive(await photosApi("/api/projects/" + project.id + "/photos"));
      } catch {
        photosCurrentArchive = { before: [], during: [], after: [] };
      }
      if (!photosCurrentArchive.before) photosCurrentArchive = { before: [], during: [], after: [] };

      if (window.SyncManager) {
        photosCurrentArchive = sanitizeArchive(
          window.SyncManager.applyPhotoDraftsToArchive(project.id, photosCurrentArchive)
        );
      }

      showModal(project);
    },

    async refresh() {
      if (!photosCurrentProjectId) return;
      try {
        const res = await photosApi("/api/projects/" + photosCurrentProjectId + "/photos");
        if (!res.error) {
          photosCurrentArchive = sanitizeArchive(res);
        }
      } catch (e) {
      }
      if (window.SyncManager) {
        photosCurrentArchive = sanitizeArchive(
          window.SyncManager.applyPhotoDraftsToArchive(photosCurrentProjectId, photosCurrentArchive)
        );
      }
      renderBody();
    },

    setArchive(archive) {
      photosCurrentArchive = sanitizeArchive(archive);
      renderBody();
    }
  };

  function showModal(project) {
    closeModal();
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "photos-modal";
    modal.innerHTML =
      '<div class="modal-overlay" data-close="1"></div>' +
      '<div class="modal-content photo-modal-content">' +
        '<div class="modal-header">' +
          '<h3>照片归档与对比 — ' + escapeHtml(project.title) + '</h3>' +
          '<button class="modal-close" data-close="1">&times;</button>' +
        '</div>' +
        '<div class="modal-body" id="photos-body"></div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.querySelectorAll("[data-close]").forEach(function(el) {
      el.onclick = closeModal;
    });

    document.addEventListener("keydown", onEscKey);
    renderBody();
  }

  function closeModal() {
    var m = document.getElementById("photos-modal");
    if (m) m.remove();
    document.removeEventListener("keydown", onEscKey);
    closeLightbox();
  }

  function onEscKey(e) {
    if (e.key === "Escape") {
      if (document.getElementById("photo-lightbox")) {
        closeLightbox();
      } else {
        closeModal();
      }
    }
  }

  function renderBody() {
    var body = document.getElementById("photos-body");
    if (!body) return;

    body.innerHTML =
      '<div class="photo-view-toggle">' +
        '<button class="photo-toggle-btn' + (photosCurrentView === "gallery" ? " active" : "") + '" data-view="gallery">图库视图</button>' +
        '<button class="photo-toggle-btn' + (photosCurrentView === "compare" ? " active" : "") + '" data-view="compare">对比视图</button>' +
      '</div>' +
      '<div id="photo-main-content"></div>';

    body.querySelectorAll(".photo-toggle-btn").forEach(function(btn) {
      btn.onclick = function() {
        photosCurrentView = btn.dataset.view;
        renderBody();
      };
    });

    if (photosCurrentView === "gallery") {
      renderGallery();
    } else {
      renderCompare();
    }
  }

  function renderGallery() {
    var container = document.getElementById("photo-main-content");
    if (!container) return;

    var html = '<div class="photo-stages">';
    STAGE_ORDER.forEach(function(stage) {
      var photos = photosCurrentArchive[stage] || [];
      html += '<div class="photo-stage">';
      html += '<div class="photo-stage-header">';
      html += '<span class="photo-stage-label ' + stage + '">' + STAGE_LABELS[stage] + '</span>';
      html += '<span class="photo-stage-count">' + photos.length + ' 张</span>';
      html += '</div>';
      html += '<div class="photo-stage-grid">';

      if (photos.length === 0) {
        html += '<div class="photo-empty">';
        html += '<div class="photo-empty-icon">📷</div>';
        html += '<div>暂无' + STAGE_LABELS[stage] + '照片</div>';
        html += '</div>';
      } else {
        photos.forEach(function(url, index) {
          html += '<div class="photo-card" data-stage="' + stage + '" data-index="' + index + '">';
          html += '<div class="photo-img-wrap photo-clickable" data-url="' + escapeHtml(url) + '" data-alt="' + STAGE_LABELS[stage] + '照片 ' + (index + 1) + '">';
          html += '<img src="' + escapeHtml(url) + '" alt="' + STAGE_LABELS[stage] + '照片 ' + (index + 1) + '" loading="lazy">';
          html += '<div class="photo-fallback"><span>图片加载失败</span></div>';
          html += '<div class="photo-zoom-hint">🔍 点击放大</div>';
          html += '</div>';
          html += '<div class="photo-card-footer">';
          html += '<span class="photo-card-index">' + (index + 1) + '/' + photos.length + '</span>';
          html += '<button class="photo-delete-btn" data-stage="' + stage + '" data-index="' + index + '" title="删除照片">&times;</button>';
          html += '</div>';
          html += '</div>';
        });
      }

      html += '</div>';
      html += '<div class="photo-add-row">';
      html += '<input class="photo-add-input" data-stage="' + stage + '" placeholder="输入照片链接 URL" />';
      html += '<button class="photo-add-btn" data-stage="' + stage + '">添加</button>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
    bindImageHandlers();
    bindGalleryEvents();
  }

  function bindGalleryEvents() {
    document.querySelectorAll(".photo-delete-btn").forEach(function(btn) {
      btn.onclick = function(e) {
        e.stopPropagation();
        deletePhoto(btn.dataset.stage, parseInt(btn.dataset.index, 10));
      };
    });

    document.querySelectorAll(".photo-add-btn").forEach(function(btn) {
      btn.onclick = function() {
        var stage = btn.dataset.stage;
        var input = document.querySelector('.photo-add-input[data-stage="' + stage + '"]');
        if (!input) return;
        addPhoto(stage, input.value.trim());
      };
    });

    document.querySelectorAll(".photo-add-input").forEach(function(input) {
      input.onkeydown = function(e) {
        if (e.key === "Enter") {
          e.preventDefault();
          var stage = input.dataset.stage;
          addPhoto(stage, input.value.trim());
        }
      };
    });
  }

  function bindImageHandlers() {
    document.querySelectorAll(".photo-img-wrap img, .photo-compare-img-wrap img").forEach(function(img) {
      var wrap = img.parentNode;
      var fallback = wrap.querySelector(".photo-fallback");
      var hint = wrap.querySelector(".photo-zoom-hint");

      function handleError() {
        img.style.display = "none";
        if (fallback) fallback.style.display = "flex";
        if (hint) hint.style.display = "none";
        wrap.classList.remove("photo-clickable");
        wrap.onclick = null;
      }

      img.onerror = handleError;

      if (img.complete) {
        if (img.naturalWidth === 0) {
          handleError();
        }
      }
    });

    document.querySelectorAll(".photo-clickable").forEach(function(wrap) {
      wrap.onclick = function() {
        var fallback = wrap.querySelector(".photo-fallback");
        if (fallback && fallback.style.display === "flex") return;
        openLightbox(wrap.dataset.url, wrap.dataset.alt);
      };
    });
  }

  async function addPhoto(stage, url) {
    if (!url) return;

    var input = document.querySelector('.photo-add-input[data-stage="' + stage + '"]');
    try {
      new URL(url);
    } catch {
      if (input) input.style.borderColor = "var(--warn)";
      setTimeout(function() { if (input) input.style.borderColor = ""; }, 2000);
      return;
    }

    var res = await photosApi("/api/projects/" + photosCurrentProjectId + "/photos", {
      method: "POST",
      body: JSON.stringify({ stage: stage, url: url, basePhotoCount: (photosCurrentArchive[stage] || []).length })
    });

    if (res.error) {
      alert(res.message || "添加失败");
      return;
    }

    if (res._savedAsDraft) {
      if (!photosCurrentArchive[stage]) photosCurrentArchive[stage] = [];
      photosCurrentArchive[stage].push(url);
      if (input) input.value = "";
      renderBody();
      alert("网络不可用，照片已保存为本地草稿。恢复连接后可在同步管理中手动同步。");
    } else {
      photosCurrentArchive = sanitizeArchive(res);
      if (input) input.value = "";
      renderBody();
    }

    if (typeof window.onPhotosUpdated === "function") {
      window.onPhotosUpdated(photosCurrentProjectId);
    }
  }

  async function deletePhoto(stage, index) {
    if (!confirm("确定删除这张" + STAGE_LABELS[stage] + "照片吗？")) return;

    const url = photosCurrentArchive[stage] && photosCurrentArchive[stage][index];

    var res = await photosApi("/api/projects/" + photosCurrentProjectId + "/photos", {
      method: "DELETE",
      body: JSON.stringify({ stage: stage, index: index, url: url, basePhotoCount: (photosCurrentArchive[stage] || []).length })
    });

    if (res.error) {
      alert(res.message || "删除失败");
      return;
    }

    if (res._savedAsDraft) {
      if (photosCurrentArchive[stage] && index >= 0 && index < photosCurrentArchive[stage].length) {
        photosCurrentArchive[stage].splice(index, 1);
      }
      renderBody();
      alert("网络不可用，删除操作已保存为本地草稿。恢复连接后可在同步管理中手动同步。");
    } else {
      photosCurrentArchive = sanitizeArchive(res);
      renderBody();
    }

    if (typeof window.onPhotosUpdated === "function") {
      window.onPhotosUpdated(photosCurrentProjectId);
    }
  }

  function renderCompare() {
    var container = document.getElementById("photo-main-content");
    if (!container) return;

    var hasAny = STAGE_ORDER.some(function(s) { return (photosCurrentArchive[s] || []).length > 0; });

    if (!hasAny) {
      container.innerHTML =
        '<div class="photo-compare-empty">' +
          '<div class="photo-empty-icon">📷</div>' +
          '<div>暂无照片，请先在图库视图中添加照片</div>' +
        '</div>';
      return;
    }

    var maxLen = Math.max.apply(null, STAGE_ORDER.map(function(s) { return (photosCurrentArchive[s] || []).length; }));

    var html = '<div class="photo-compare">';
    html += '<div class="photo-compare-header-row">';
    STAGE_ORDER.forEach(function(stage) {
      html += '<div class="photo-compare-col-header ' + stage + '">' + STAGE_LABELS[stage] + '</div>';
    });
    html += '</div>';

    for (var row = 0; row < maxLen; row++) {
      html += '<div class="photo-compare-row">';
      STAGE_ORDER.forEach(function(stage) {
        var photos = photosCurrentArchive[stage] || [];
        if (row < photos.length) {
          html += '<div class="photo-compare-cell">';
          html += '<div class="photo-compare-img-wrap photo-clickable" data-url="' + escapeHtml(photos[row]) + '" data-alt="' + STAGE_LABELS[stage] + '照片 ' + (row + 1) + '">';
          html += '<img src="' + escapeHtml(photos[row]) + '" alt="' + STAGE_LABELS[stage] + '照片 ' + (row + 1) + '" loading="lazy">';
          html += '<div class="photo-fallback"><span>图片加载失败</span></div>';
          html += '</div>';
          html += '<div class="photo-compare-label">' + STAGE_LABELS[stage] + ' ' + (row + 1) + '</div>';
          html += '</div>';
        } else {
          html += '<div class="photo-compare-cell empty">';
          html += '<div class="photo-compare-placeholder"><span>暂无' + STAGE_LABELS[stage] + '照片</span></div>';
          html += '</div>';
        }
      });
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
    bindImageHandlers();
  }

  function openLightbox(url, alt) {
    closeLightbox();
    var lb = document.createElement("div");
    lb.id = "photo-lightbox";
    lb.className = "photo-lightbox";
    lb.innerHTML =
      '<div class="photo-lightbox-overlay"></div>' +
      '<div class="photo-lightbox-content">' +
        '<button class="photo-lightbox-close" title="关闭">&times;</button>' +
        '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt) + '">' +
        '<div class="photo-lightbox-caption">' + escapeHtml(alt || "") + '</div>' +
        '<div class="photo-lightbox-fallback" style="display:none;"><span>图片加载失败，请检查链接是否有效</span></div>' +
      '</div>';
    document.body.appendChild(lb);

    var overlay = lb.querySelector(".photo-lightbox-overlay");
    var closeBtn = lb.querySelector(".photo-lightbox-close");
    var img = lb.querySelector("img");
    var fallback = lb.querySelector(".photo-lightbox-fallback");

    overlay.onclick = closeLightbox;
    closeBtn.onclick = closeLightbox;

    img.onerror = function() {
      this.style.display = "none";
      var caption = this.parentNode.querySelector(".photo-lightbox-caption");
      if (caption) caption.style.display = "none";
      fallback.style.display = "flex";
    };

    document.addEventListener("keydown", onLightboxKey);
  }

  function onLightboxKey(e) {
    if (e.key === "Escape") {
      closeLightbox();
    }
  }

  function closeLightbox() {
    var lb = document.getElementById("photo-lightbox");
    if (lb) lb.remove();
    document.removeEventListener("keydown", onLightboxKey);
  }
})();
