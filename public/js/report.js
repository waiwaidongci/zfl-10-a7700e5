(function() {
  const viewerSelect = document.querySelector("#viewer");
  let currentView = "current";
  let snapshotList = [];
  let currentSnapshotData = null;
  let currentReportData = null;

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function getViewerId() {
    const stored = localStorage.getItem("viewerId");
    if (stored) return stored;
    return "u-admin";
  }

  function getProjectId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("projectId");
  }

  async function api(path, options) {
    const headers = { "Content-Type": "application/json" };
    const viewerId = getViewerId();
    if (viewerId) headers["X-Viewer-Id"] = viewerId;
    const res = await fetch(path, options && options.body ? { ...options, headers } : (options ? { ...options, headers } : { headers }));
    return res.json();
  }

  function formatDate(isoString) {
    if (!isoString) return "-";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toISOString().slice(0, 10);
  }

  function formatDateTime(isoString) {
    if (!isoString) return "-";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function showLoading() {
    document.getElementById("reportLoading").style.display = "flex";
    document.getElementById("reportError").style.display = "none";
    document.getElementById("reportContent").style.display = "none";
  }

  function showError(message) {
    document.getElementById("reportLoading").style.display = "none";
    document.getElementById("reportError").style.display = "flex";
    document.getElementById("reportErrorText").textContent = message;
    document.getElementById("reportContent").style.display = "none";
  }

  function showContent() {
    document.getElementById("reportLoading").style.display = "none";
    document.getElementById("reportError").style.display = "none";
    document.getElementById("reportContent").style.display = "block";
  }

  function buildProcessRecords(process) {
    const wrap = document.getElementById("processRecordsWrap");

    if (!process.hasRecords) {
      wrap.innerHTML =
        '<div class="report-empty">' +
          '<div class="report-empty-icon">📝</div>' +
          '<div class="report-empty-text">暂无修复过程记录</div>' +
        '</div>';
      return;
    }

    let html = '<div class="report-timeline">';
    process.records.forEach(function(record, index) {
      html +=
        '<div class="report-timeline-item">' +
          '<div class="report-timeline-marker">' + escapeHtml(String(index + 1)) + '</div>' +
          '<div class="report-timeline-body">' +
            '<div class="report-timeline-head">' +
              '<span class="report-timeline-date">' + escapeHtml(record.date) + '</span>' +
              '<span class="report-timeline-operator">操作人：' + escapeHtml(record.operator) + '</span>' +
            '</div>' +
            '<div class="report-timeline-content">' +
              '<div class="report-timeline-row"><span class="report-timeline-label">处理步骤：</span><span>' + escapeHtml(record.steps) + '</span></div>' +
              (record.materials ? '<div class="report-timeline-row"><span class="report-timeline-label">使用材料：</span><span>' + escapeHtml(record.materials) + '</span></div>' : '') +
              (record.notes ? '<div class="report-timeline-row"><span class="report-timeline-label">备　　注：</span><span>' + escapeHtml(record.notes) + '</span></div>' : '') +
              (record.photoUrl ? '<div class="report-timeline-row"><span class="report-timeline-label">照片链接：</span><a href="' + escapeHtml(record.photoUrl) + '" target="_blank" class="report-link">' + escapeHtml(record.photoUrl) + '</a></div>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';

    wrap.innerHTML = html;
  }

  function buildPhotoStage(label, stage, urls, stageClass) {
    if (!urls || urls.length === 0) {
      return '';
    }

    let html =
      '<div class="report-photo-stage">' +
        '<div class="report-photo-stage-label ' + escapeHtml(stageClass) + '">' + escapeHtml(label) + '（' + urls.length + '张）</div>' +
        '<div class="report-photo-grid">';

    urls.forEach(function(url, idx) {
      html +=
        '<div class="report-photo-card">' +
          '<div class="report-photo-wrap">' +
            '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(label + ' ' + (idx + 1)) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
            '<div class="report-photo-fallback" style="display:none;">图片加载失败</div>' +
          '</div>' +
          '<div class="report-photo-caption">' + escapeHtml(label) + ' - 图' + (idx + 1) + '</div>' +
        '</div>';
    });

    html += '</div></div>';
    return html;
  }

  function buildPhotos(photos) {
    const wrap = document.getElementById("photosWrap");

    if (!photos.hasPhotos) {
      wrap.innerHTML =
        '<div class="report-empty">' +
          '<div class="report-empty-icon">📷</div>' +
          '<div class="report-empty-text">暂无照片档案</div>' +
        '</div>';
      return;
    }

    let html = '';
    html += buildPhotoStage('修复前', 'before', photos.archive.before, 'before');
    html += buildPhotoStage('修复中', 'during', photos.archive.during, 'during');
    html += buildPhotoStage('修复后', 'after', photos.archive.after, 'after');

    wrap.innerHTML = html;
  }

  function buildTemplateInfo(template, reviewRequirements) {
    const section = document.getElementById("templateSection");
    if (!section) return;

    if (!template && !reviewRequirements) {
      section.style.display = "none";
      return;
    }

    section.style.display = "block";
    const wrap = document.getElementById("templateWrap");
    if (!wrap) return;

    let html = '';

    if (template) {
      html += '<div class="report-template-info">';
      html += '<div class="report-template-name">' + escapeHtml(template.templateName || '未知模板') + '</div>';
      html += '<div class="report-template-meta">';
      if (template.templateCategory) {
        html += '<span>类型：' + escapeHtml(template.templateCategory) + '</span>';
      }
      if (template.templateVersion) {
        html += '<span>版本：v' + template.templateVersion + '</span>';
      }
      if (template.estimatedDays) {
        html += '<span>预计工期：' + template.estimatedDays + '天</span>';
      }
      html += '</div>';
      html += '</div>';
    }

    if (reviewRequirements) {
      html += '<div class="report-review-requirements">' +
        '<div class="report-requirements-title">📋 模板复核要求</div>' +
        '<div class="report-requirements-content">' + escapeHtml(reviewRequirements) + '</div>' +
      '</div>';
    }

    wrap.innerHTML = html;
  }

  function buildReviews(reviews) {
    const section = document.getElementById("reviewSection");
    const wrap = document.getElementById("reviewWrap");

    if (!reviews.hasReviews) {
      section.style.display = "none";
      return;
    }

    section.style.display = "block";

    let html = '';

    if (reviews.lastRejection) {
      html += '<div class="report-rejection-notice">' +
        '<div class="report-rejection-icon">⚠️</div>' +
        '<div class="report-rejection-body">' +
          '<div class="report-rejection-title">最近一次退回原因</div>' +
          '<div class="report-rejection-meta">复核人：' + escapeHtml(reviews.lastRejection.reviewer) + ' · ' + escapeHtml(reviews.lastRejection.reviewedAt) + '</div>' +
          '<div class="report-rejection-opinion">' + escapeHtml(reviews.lastRejection.opinion) + '</div>' +
        '</div>' +
      '</div>';
    }

    html += '<div class="report-review-list">';
    reviews.records.forEach(function(record, index) {
      const isPass = record.result === "通过";
      html +=
        '<div class="report-review-item">' +
          '<div class="report-review-head">' +
            '<span class="report-review-index">第' + (index + 1) + '次复核</span>' +
            '<span class="report-reviewer">复核人：' + escapeHtml(record.reviewer) + '</span>' +
            '<span class="report-review-date">' + escapeHtml(record.reviewedAt) + '</span>' +
            '<span class="report-review-result ' + (isPass ? 'pass' : 'reject') + '">' + escapeHtml(record.result) + '</span>' +
          '</div>' +
          '<div class="report-review-opinion">' + escapeHtml(record.opinion) + '</div>' +
        '</div>';
    });
    html += '</div>';

    wrap.innerHTML = html;
  }

  function renderReport(data, snapshotMeta) {
    const badge = document.getElementById("reportBadge");
    if (snapshotMeta) {
      badge.style.display = "inline-block";
      badge.className = "report-badge snapshot-badge";
      badge.textContent = "📦 快照版本";
    } else {
      badge.style.display = "inline-block";
      badge.className = "report-badge current-badge";
      badge.textContent = "实时报告";
    }

    document.getElementById("reportMeta").textContent = data.project.id + " · " + data.project.title;

    document.getElementById("reportId").textContent = data.project.id;
    document.getElementById("reportGeneratedAt").textContent = formatDate(data.generatedAt);
    document.getElementById("reportOwner").textContent = data.project.owner;
    document.getElementById("reportCompletionDate").textContent = formatDate(data.project.completionDate);

    document.getElementById("artifactTitle").textContent = data.artifact.title;
    document.getElementById("artifactEra").textContent = data.artifact.era;
    document.getElementById("artifactDamage").textContent = data.artifact.damage;

    document.getElementById("restorationSteps").textContent = data.restoration.steps;
    document.getElementById("restorationMaterials").textContent = data.restoration.materials;

    buildTemplateInfo(data.template, data.reviewRequirements);
    buildProcessRecords(data.process);
    buildPhotos(data.photos);
    buildReviews(data.reviews);

    showContent();
  }

  async function loadReport() {
    const projectId = getProjectId();
    if (!projectId) {
      showError("缺少项目ID参数");
      return;
    }

    showLoading();

    try {
      const data = await api("/api/projects/" + encodeURIComponent(projectId) + "/report");
      if (data.error) {
        showError(data.message || "加载报告失败：" + data.error);
        return;
      }
      currentReportData = data;
      renderReport(data, null);
      await loadSnapshotList();
    } catch (e) {
      showError("网络错误：" + e.message);
    }
  }

  async function loadSnapshotList() {
    const projectId = getProjectId();
    if (!projectId) return;

    try {
      const data = await api("/api/projects/" + encodeURIComponent(projectId) + "/report-snapshots");
      if (data && data.snapshots) {
        snapshotList = data.snapshots;
        updateSnapshotSelect();
        updateSwitcherVisibility();
      }
    } catch (e) {
      console.warn("加载快照列表失败:", e);
    }
  }

  function updateSnapshotSelect() {
    const select = document.getElementById("snapshotSelect");
    const options = ['<option value="">-- 请选择历史快照 --</option>'];
    snapshotList.forEach(function(s) {
      const label = `${s.snapshotName} (${formatDateTime(s.archivedAt)} · ${s.archivedBy})`;
      options.push(`<option value="${escapeHtml(s.id)}">${escapeHtml(label)}</option>`);
    });
    select.innerHTML = options.join("");
  }

  function updateSwitcherVisibility() {
    const switcher = document.getElementById("reportSwitcher");
    if (snapshotList.length > 0) {
      switcher.style.display = "flex";
    } else {
      switcher.style.display = "none";
    }
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".report-tab").forEach(function(tab) {
      if (tab.dataset.view === view) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });

    const snapshotSelectWrap = document.getElementById("snapshotSelectWrap");
    const snapshotInfo = document.getElementById("snapshotInfo");

    if (view === "current") {
      snapshotSelectWrap.style.display = "none";
      snapshotInfo.style.display = "none";
      document.getElementById("archiveBtn").style.display = "";
      if (currentReportData) {
        renderReport(currentReportData, null);
      }
    } else {
      snapshotSelectWrap.style.display = "block";
      snapshotInfo.style.display = "none";
      document.getElementById("archiveBtn").style.display = "none";
      const selectedId = document.getElementById("snapshotSelect").value;
      if (selectedId) {
        loadAndRenderSnapshot(selectedId);
      }
    }
  }

  async function loadAndRenderSnapshot(snapshotId) {
    const projectId = getProjectId();
    if (!projectId || !snapshotId) return;

    showLoading();
    const snapshotInfo = document.getElementById("snapshotInfo");

    try {
      const data = await api(
        "/api/projects/" + encodeURIComponent(projectId) + "/report-snapshots/" + encodeURIComponent(snapshotId)
      );
      if (data.error) {
        showError(data.message || "加载快照失败：" + data.error);
        return;
      }
      currentSnapshotData = data;
      renderReport(data.data, data);
      snapshotInfo.style.display = "block";
      snapshotInfo.innerHTML =
        '<span class="snapshot-info-badge">📦 ' + escapeHtml(data.snapshotName) + '</span>' +
        '<span>归档人：' + escapeHtml(data.archivedBy) + '</span>' +
        '<span>归档时间：' + escapeHtml(formatDateTime(data.archivedAt)) + '</span>' +
        (data.note ? '<span class="snapshot-note">备注：' + escapeHtml(data.note) + '</span>' : '');
    } catch (e) {
      showError("网络错误：" + e.message);
    }
  }

  function showArchiveModal() {
    const modal = document.getElementById("archiveModal");
    document.getElementById("snapshotName").value = `报告快照 ${new Date().toISOString().slice(0, 10)}`;
    document.getElementById("snapshotNote").value = "";
    modal.style.display = "flex";
  }

  function hideArchiveModal() {
    document.getElementById("archiveModal").style.display = "none";
  }

  async function confirmArchive() {
    const projectId = getProjectId();
    if (!projectId) return;

    const name = document.getElementById("snapshotName").value.trim();
    const note = document.getElementById("snapshotNote").value.trim();

    if (!name) {
      alert("请填写快照名称");
      return;
    }

    const confirmBtn = document.getElementById("archiveConfirmBtn");
    const originalText = confirmBtn.textContent;
    confirmBtn.textContent = "归档中...";
    confirmBtn.disabled = true;

    try {
      const result = await api(
        "/api/projects/" + encodeURIComponent(projectId) + "/report-snapshots",
        {
          method: "POST",
          body: JSON.stringify({ name: name, note: note })
        }
      );

      if (result.error) {
        alert(result.message || "归档失败：" + result.error);
        return;
      }

      alert("✅ 报告快照归档成功！");
      hideArchiveModal();
      await loadSnapshotList();
    } catch (e) {
      alert("网络错误：" + e.message);
    } finally {
      confirmBtn.textContent = originalText;
      confirmBtn.disabled = false;
    }
  }

  function initEvents() {
    document.getElementById("backBtn").onclick = function() {
      window.location.href = "/";
    };

    document.getElementById("printBtn").onclick = function() {
      window.print();
    };

    document.getElementById("retryBtn").onclick = function() {
      if (currentView === "current") {
        loadReport();
      } else {
        const selectedId = document.getElementById("snapshotSelect").value;
        if (selectedId) loadAndRenderSnapshot(selectedId);
      }
    };

    document.getElementById("archiveBtn").onclick = function() {
      showArchiveModal();
    };

    document.getElementById("archiveModalClose").onclick = hideArchiveModal;
    document.getElementById("archiveCancelBtn").onclick = hideArchiveModal;
    document.getElementById("archiveConfirmBtn").onclick = confirmArchive;

    document.querySelectorAll(".report-tab").forEach(function(tab) {
      tab.onclick = function() {
        switchView(tab.dataset.view);
      };
    });

    document.getElementById("snapshotSelect").onchange = function(e) {
      const value = e.target.value;
      if (value) {
        loadAndRenderSnapshot(value);
      } else {
        document.getElementById("snapshotInfo").style.display = "none";
      }
    };

    document.getElementById("archiveModal").onclick = function(e) {
      if (e.target === this) {
        hideArchiveModal();
      }
    };
  }

  initEvents();
  loadReport();
})();
