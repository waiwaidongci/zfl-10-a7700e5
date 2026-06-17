(function() {
  var _dataVersion = null;

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function(c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function saveFormData(formEl) {
    if (!formEl) return null;
    var data = {};
    var elements = formEl.elements;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.name || el.type === "button" || el.type === "submit" || el.type === "reset") continue;
      if (el.type === "checkbox") {
        data[el.name] = el.checked;
      } else if (el.type === "select-multiple") {
        data[el.name] = Array.from(el.selectedOptions).map(function(o) { return o.value; });
      } else {
        data[el.name] = el.value;
      }
    }
    return data;
  }

  function restoreFormData(formEl, data) {
    if (!formEl || !data) return;
    var elements = formEl.elements;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.name || el.type === "button" || el.type === "submit" || el.type === "reset") continue;
      if (!(el.name in data)) continue;
      if (el.type === "checkbox") {
        el.checked = !!data[el.name];
      } else if (el.type === "select-multiple") {
        var vals = data[el.name];
        Array.from(el.options).forEach(function(opt) {
          opt.selected = vals.indexOf(opt.value) !== -1;
        });
      } else {
        el.value = data[el.name];
      }
    }
  }

  function saveDraftToLocalStorage(key, formData, page) {
    try {
      var draft = {
        key: key,
        page: page,
        data: formData,
        savedAt: new Date().toISOString(),
        dataVersion: _dataVersion
      };
      var existing = [];
      try {
        existing = JSON.parse(localStorage.getItem("restoration_conflict_drafts") || "[]");
      } catch (e) {}
      existing.unshift(draft);
      if (existing.length > 20) existing = existing.slice(0, 20);
      localStorage.setItem("restoration_conflict_drafts", JSON.stringify(existing));
      return true;
    } catch (e) {
      return false;
    }
  }

  function showModal(options) {
    closeModal();
    var clientVersion = options.clientDataVersion;
    var serverVersion = options.serverDataVersion;
    var onReload = options.onReload;
    var onSaveDraft = options.onSaveDraft;
    var onRetry = options.onRetry;
    var formData = options.formData;
    var formEl = options.formEl;
    var pageLabel = options.pageLabel || "当前页面";

    var modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "dvc-modal";

    var html =
      '<div class="modal-overlay" data-dvc-close="1"></div>' +
      '<div class="modal-content" style="max-width:520px;">' +
        '<div class="modal-header">' +
          '<h3>\u26A0\uFE0F 数据版本冲突</h3>' +
          '<button class="modal-close" data-dvc-close="1">&times;</button>' +
        '</div>' +
        '<div class="modal-body" style="padding:20px;">' +
          '<div style="margin-bottom:16px;">' +
            '<p style="margin:0 0 8px;font-size:14px;color:#5a5248;">' +
              '您基于的数据版本 (v' + escapeHtml(String(clientVersion)) + ') 已被其他操作更新至 v' + escapeHtml(String(serverVersion)) + '，直接保存可能覆盖他人的修改。' +
            '</p>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px;">' +
            '<button class="dvc-option-btn" data-dvc-action="retry" style="padding:12px 16px;border:2px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;cursor:pointer;font-size:14px;text-align:left;">' +
              '<div style="font-weight:700;margin-bottom:4px;">\uD83D\uDD04 合并重试（推荐）</div>' +
              '<div style="font-size:12px;opacity:0.85;">重新加载最新数据，自动应用您的修改并保存</div>' +
            '</button>' +
            '<button class="dvc-option-btn" data-dvc-action="draft" style="padding:12px 16px;border:2px solid #d8d2c7;background:#faf7f0;border-radius:8px;cursor:pointer;font-size:14px;text-align:left;">' +
              '<div style="font-weight:700;margin-bottom:4px;">\uD83D\uDCDD 保存为草稿</div>' +
              '<div style="font-size:12px;color:#8a8278;">保留您已输入的内容，稍后在同步管理中手动提交</div>' +
            '</button>' +
            '<button class="dvc-option-btn" data-dvc-action="reload" style="padding:12px 16px;border:2px solid #d8d2c7;background:#faf7f0;border-radius:8px;cursor:pointer;font-size:14px;text-align:left;">' +
              '<div style="font-weight:700;margin-bottom:4px;">\uD83D\uDD0D 放弃修改并重新加载</div>' +
              '<div style="font-size:12px;color:#8a8278;">丢弃您的修改，加载最新的服务端数据</div>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    modal.innerHTML = html;
    document.body.appendChild(modal);

    modal.querySelectorAll("[data-dvc-close]").forEach(function(el) {
      el.onclick = function() { closeModal(); };
    });

    modal.querySelector('[data-dvc-action="retry"]').onclick = function() {
      closeModal();
      if (typeof onRetry === "function") onRetry();
    };

    modal.querySelector('[data-dvc-action="draft"]').onclick = function() {
      var saved = false;
      if (typeof onSaveDraft === "function") {
        saved = onSaveDraft(formData);
      }
      if (!saved && formData) {
        saved = saveDraftToLocalStorage("dvc_" + Date.now(), formData, pageLabel);
      }
      closeModal();
      if (saved) {
        alert("已保存为草稿，可在同步管理中手动提交。");
      }
    };

    modal.querySelector('[data-dvc-action="reload"]').onclick = function() {
      closeModal();
      if (typeof onReload === "function") {
        onReload();
      } else {
        location.reload();
      }
    };

    document.addEventListener("keydown", onEscKey);
  }

  function closeModal() {
    var m = document.getElementById("dvc-modal");
    if (m) m.remove();
    document.removeEventListener("keydown", onEscKey);
  }

  function onEscKey(e) {
    if (e.key === "Escape") closeModal();
  }

  window.DataVersionConflictHandler = {
    getVersion: function() {
      return _dataVersion;
    },

    updateVersion: function(version) {
      if (version !== undefined && version !== null) {
        _dataVersion = Number(version);
      }
    },

    extractVersionFromResponse: function(response) {
      var dv = response.headers && response.headers.get("X-Data-Version");
      if (dv) {
        _dataVersion = Number(dv);
      }
      return _dataVersion;
    },

    isConflictError: function(data, status) {
      if (status === 409 && data && data.error === "data_version_conflict") {
        return true;
      }
      return false;
    },

    handleConflict: function(errorData, options) {
      options = options || {};
      showModal({
        clientDataVersion: errorData.clientDataVersion,
        serverDataVersion: errorData.serverDataVersion,
        onReload: options.onReload,
        onSaveDraft: options.onSaveDraft,
        onRetry: options.onRetry,
        formData: options.formData,
        formEl: options.formEl,
        pageLabel: options.pageLabel
      });
    },

    saveFormData: saveFormData,
    restoreFormData: restoreFormData,
    saveDraftToLocalStorage: saveDraftToLocalStorage
  };
})();
