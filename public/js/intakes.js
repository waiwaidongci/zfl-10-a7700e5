const form = document.querySelector("#intakeForm");
const intakesEl = document.querySelector("#intakes");
const statsEl = document.querySelector("#stats");

let intakes = [];

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, options) {
  const headers = { "Content-Type": "application/json" };
  if (options && options.method && options.method !== "GET") {
    const dv = window.DataVersionConflictHandler ? window.DataVersionConflictHandler.getVersion() : null;
    if (dv !== null) headers["X-Data-Version"] = String(dv);
  }
  const res = await fetch(path, options && options.body ? { ...options, headers } : options);
  if (window.DataVersionConflictHandler) window.DataVersionConflictHandler.extractVersionFromResponse(res);
  const data = await res.json();
  if (res.status === 409 && data.error === "data_version_conflict") {
    if (window.DataVersionConflictHandler) window.DataVersionConflictHandler.updateVersion(data.serverDataVersion);
    return { ...data, _dataVersionConflict: true };
  }
  return data;
}

function handleDataVersionConflict(errorData, options) {
  if (!window.DataVersionConflictHandler) {
    alert("数据已被其他操作修改，请刷新页面后重试。");
    location.reload();
    return;
  }
  var formEl = options && options.formEl;
  var formData = formEl ? window.DataVersionConflictHandler.saveFormData(formEl) : (options && options.formData);
  window.DataVersionConflictHandler.handleConflict(errorData, {
    pageLabel: options && options.pageLabel ? options.pageLabel : "入库",
    formData: formData,
    formEl: formEl,
    onReload: function() { location.reload(); },
    onSaveDraft: function(data) {
      return window.DataVersionConflictHandler.saveDraftToLocalStorage("intake_" + Date.now(), data, "入库");
    },
    onRetry: options && options.onRetry ? options.onRetry : function() { load(); }
  });
}

function statusClass(status) {
  if (status === "待修复") return "pending";
  if (status === "已立项") return "linked";
  if (status === "修复中") return "active";
  if (status === "已完成") return "done";
  return "";
}

function render() {
  const pending = intakes.filter((i) => i.status === "待修复").length;
  const linked = intakes.filter((i) => i.status === "已立项").length;
  const total = intakes.length;

  statsEl.innerHTML =
    '<div class="stat"><span>待修复</span><strong>' + pending + '</strong></div>' +
    '<div class="stat"><span>已立项</span><strong>' + linked + '</strong></div>' +
    '<div class="stat"><span>累计入库</span><strong>' + total + '</strong></div>';

  intakesEl.innerHTML = intakes.map((i) => {
    let linkedHtml = '';
    if (i.status === '已立项' && i.projectId) {
      linkedHtml = '<div class="intake-linked"><b>已关联项目：</b><a class="project-link" href="/" target="_blank">' + escapeHtml(i.projectId) + ' ↗</a></div>';
    }

    let statusBtnHtml = '';
    if (i.status === '已立项') {
      statusBtnHtml = '<button class="secondary" disabled style="opacity:0.6;cursor:not-allowed;">已立项</button>';
    } else {
      statusBtnHtml = '<button class="secondary" data-action="status" data-id="' + escapeHtml(i.id) + '">更新状态</button>';
    }

    return (
      '<article>' +
      '<div class="row"><h3>' + escapeHtml(i.title) + '</h3><span class="pill ' + statusClass(i.status) + '">' + escapeHtml(i.status) + '</span></div>' +
      '<div class="meta">' + escapeHtml(i.era || '年代不详') + ' · 来源：' + escapeHtml(i.source || '未知') + '</div>' +
      '<div><b>接收人：</b>' + escapeHtml(i.receiver || '-') + '</div>' +
      '<div><b>接收时间：</b>' + escapeHtml(i.receivedAt || '-') + '</div>' +
      '<div><b>破损描述：</b>' + escapeHtml(i.damage || '-') + '</div>' +
      '<div><b>存放位置：</b>' + escapeHtml(i.tempLocation || '-') + '</div>' +
      linkedHtml +
      '<div class="actions">' +
      statusBtnHtml +
      '<button class="danger" data-action="delete" data-id="' + escapeHtml(i.id) + '">删除</button>' +
      '</div>' +
      '</article>'
    );
  }).join("");

  document.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.onclick = async () => {
      if (confirm("确定删除这条入库记录吗？")) {
        const result = await api('/api/intakes/' + btn.dataset.id, { method: 'DELETE' });
        if (result._dataVersionConflict) {
          handleDataVersionConflict(result, {
            pageLabel: "删除入库记录",
            onRetry: async () => {
              await load();
              await api('/api/intakes/' + btn.dataset.id, { method: 'DELETE' });
              await load();
            }
          });
          return;
        }
        await load();
      }
    };
  });

  document.querySelectorAll('[data-action="status"]').forEach((btn) => {
    btn.onclick = async () => {
      const intake = intakes.find((i) => i.id === btn.dataset.id);
      const statuses = ["待修复", "修复中", "已完成"];
      const nextIdx = (statuses.indexOf(intake.status) + 1) % statuses.length;
      const result = await api('/api/intakes/' + intake.id, {
        method: 'PATCH',
        body: JSON.stringify({ status: statuses[nextIdx] })
      });
      if (result._dataVersionConflict) {
        handleDataVersionConflict(result, {
          pageLabel: "更新入库状态",
          onRetry: async () => {
            await load();
            const updated = intakes.find(i => i.id === intake.id);
            if (updated) {
              await api('/api/intakes/' + intake.id, {
                method: 'PATCH',
                body: JSON.stringify({ status: statuses[nextIdx] })
              });
            }
            await load();
          }
        });
        return;
      }
      await load();
    };
  });
}

async function load() {
  intakes = await api("/api/intakes");
  render();
}

form.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const result = await api("/api/intakes", { method: "POST", body: JSON.stringify(data) });
  if (result._dataVersionConflict) {
    handleDataVersionConflict(result, {
      formEl: form,
      pageLabel: "新建入库记录",
      onRetry: async () => {
        await load();
        const retryResult = await api("/api/intakes", { method: "POST", body: JSON.stringify(data) });
        if (!retryResult.error && !retryResult._dataVersionConflict) {
          form.reset();
        }
        await load();
      }
    });
    return;
  }
  form.reset();
  await load();
};

load();
