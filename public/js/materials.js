const form = document.querySelector("#form");
const materialsEl = document.querySelector("#materials");
const statsEl = document.querySelector("#stats");
const movementsEl = document.querySelector("#movements");
const movementPaginationEl = document.querySelector("#movement-pagination");
const movementTypeFilter = document.querySelector("#movement-type-filter");
const movementMaterialFilter = document.querySelector("#movement-material-filter");

let materials = [];
let editingId = null;
let allMovements = [];
let movementPage = 1;
const movementPageSize = 10;

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, options) {
  const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
  return res.json();
}

function isLowStock(m) {
  return m.quantity <= m.lowStockThreshold;
}

function renderStats() {
  const total = materials.length;
  const lowStock = materials.filter(isLowStock).length;
  const totalValue = materials.reduce((sum, m) => sum + m.quantity, 0);

  statsEl.innerHTML =
    '<div class="stat"><span>材料种类</span><strong>' + total + '</strong></div>' +
    '<div class="stat"><span>低库存预警</span><strong style="color: var(--warn);">' + lowStock + '</strong></div>' +
    '<div class="stat"><span>库存总数</span><strong>' + totalValue + '</strong></div>';
}

function render() {
  renderStats();

  if (materials.length === 0) {
    materialsEl.innerHTML = '<p style="color: #6b6258;">暂无材料记录</p>';
    return;
  }

  materialsEl.innerHTML = materials.map((m) => {
    const low = isLowStock(m);
    const cls = low ? 'overdue' : '';
    return (
      '<article class="' + cls + '">' +
      '<div class="row"><h3>' + escapeHtml(m.name) + '</h3>' +
      (low ? '<span class="pill pending">库存不足</span>' : '<span class="pill active">库存正常</span>') +
      '</div>' +
      '<div class="meta">更新时间：' + escapeHtml(m.updatedAt) + '</div>' +
      '<div><b>当前库存</b> ' + escapeHtml(m.quantity) + ' ' + escapeHtml(m.unit) + '</div>' +
      '<div><b>低库存阈值</b> ' + escapeHtml(m.lowStockThreshold) + ' ' + escapeHtml(m.unit) + '</div>' +
      (low ? '<div class="danger">库存已低于预警阈值，请及时补充</div>' : '') +
      '<div class="actions">' +
      '<button class="secondary" data-edit="' + escapeHtml(m.id) + '">编辑</button>' +
      '<button class="danger" data-delete="' + escapeHtml(m.id) + '">删除</button>' +
      '</div>' +
      '</article>'
    );
  }).join("");

  document.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.onclick = () => startEdit(btn.dataset.edit);
  });

  document.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.onclick = async () => {
      if (confirm("确定要删除这个材料吗？")) {
        await api("/api/materials/" + btn.dataset.delete, { method: "DELETE" });
        await load();
      }
    };
  });
}

function startEdit(id) {
  const material = materials.find((m) => m.id === id);
  if (!material) return;

  editingId = id;
  form.name.value = material.name;
  form.unit.value = material.unit;
  form.quantity.value = material.quantity;
  form.lowStockThreshold.value = material.lowStockThreshold;

  const submitBtn = form.querySelector("button[type='submit']");
  submitBtn.textContent = "更新材料";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "secondary";
  cancelBtn.textContent = "取消";
  cancelBtn.style.marginTop = "8px";
  cancelBtn.style.width = "100%";
  cancelBtn.onclick = cancelEdit;

  const existingCancel = form.querySelector(".cancel-btn");
  if (existingCancel) existingCancel.remove();

  cancelBtn.classList.add("cancel-btn");
  form.appendChild(cancelBtn);
}

function cancelEdit() {
  editingId = null;
  form.reset();
  const submitBtn = form.querySelector("button[type='submit']");
  submitBtn.textContent = "保存材料";
  const cancelBtn = form.querySelector(".cancel-btn");
  if (cancelBtn) cancelBtn.remove();
}

async function load() {
  materials = await api("/api/materials");
  render();
  renderMaterialFilter();
  await loadMovements();
}

async function loadMovements() {
  try {
    allMovements = await api("/api/materials/movements");
  } catch {
    allMovements = [];
  }
  movementPage = 1;
  renderMovements();
}

function renderMaterialFilter() {
  const uniqueNames = [...new Set(materials.map(m => m.name))];
  movementMaterialFilter.innerHTML =
    '<option value="">全部材料</option>' +
    uniqueNames.map(n => '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>').join('');
}

function getFilteredMovements() {
  let filtered = allMovements;
  const typeVal = movementTypeFilter ? movementTypeFilter.value : '';
  const matVal = movementMaterialFilter ? movementMaterialFilter.value : '';
  if (typeVal) {
    filtered = filtered.filter(m => m.type === typeVal);
  }
  if (matVal) {
    filtered = filtered.filter(m => m.materialName === matVal);
  }
  return filtered;
}

function formatMovementType(type) {
  const map = { consume: '消耗', restore: '恢复', restock: '入库' };
  return map[type] || type;
}

function formatMovementTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function renderMovements() {
  if (!movementsEl) return;
  const filtered = getFilteredMovements();
  const totalPages = Math.max(1, Math.ceil(filtered.length / movementPageSize));
  if (movementPage > totalPages) movementPage = totalPages;
  const start = (movementPage - 1) * movementPageSize;
  const pageItems = filtered.slice(start, start + movementPageSize);

  if (filtered.length === 0) {
    movementsEl.innerHTML = '<div class="movement-empty">暂无库存变动记录</div>';
    movementPaginationEl.innerHTML = '';
    return;
  }

  movementsEl.innerHTML = pageItems.map(m => {
    const sign = m.type === 'consume' ? '-' : '+';
    const detail = sign + m.quantity + ' ' + escapeHtml(m.unit || '');
    return (
      '<div class="movement-item">' +
        '<span class="movement-type ' + escapeHtml(m.type) + '">' + formatMovementType(m.type) + '</span>' +
        '<span class="movement-material">' + escapeHtml(m.materialName || '') + '</span>' +
        '<span class="movement-detail">' + detail + '</span>' +
        '<span class="movement-balance">余额：' + m.balanceAfter + ' ' + escapeHtml(m.unit || '') + '</span>' +
        '<span class="movement-note" title="' + escapeHtml(m.note || '') + '">' + escapeHtml(m.note || '') + '</span>' +
        '<span class="movement-time">' + formatMovementTime(m.createdAt) + '</span>' +
      '</div>'
    );
  }).join('');

  if (totalPages <= 1) {
    movementPaginationEl.innerHTML = '';
    return;
  }
  let paginationHtml = '';
  if (movementPage > 1) {
    paginationHtml += '<button class="secondary" id="mov-prev">上一页</button>';
  }
  paginationHtml += '<span style="font-size:12px;color:#8a8278;align-self:center;">' + movementPage + ' / ' + totalPages + '</span>';
  if (movementPage < totalPages) {
    paginationHtml += '<button class="secondary" id="mov-next">下一页</button>';
  }
  movementPaginationEl.innerHTML = paginationHtml;

  const prevBtn = document.getElementById('mov-prev');
  const nextBtn = document.getElementById('mov-next');
  if (prevBtn) prevBtn.onclick = () => { movementPage--; renderMovements(); };
  if (nextBtn) nextBtn.onclick = () => { movementPage++; renderMovements(); };
}

form.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());

  if (editingId) {
    await api("/api/materials/" + editingId, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
    cancelEdit();
  } else {
    await api("/api/materials", {
      method: "POST",
      body: JSON.stringify(data)
    });
    form.reset();
  }

  await load();
};

if (movementTypeFilter) {
  movementTypeFilter.onchange = () => { movementPage = 1; renderMovements(); };
}
if (movementMaterialFilter) {
  movementMaterialFilter.onchange = () => { movementPage = 1; renderMovements(); };
}

load();
