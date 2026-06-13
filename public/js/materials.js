const form = document.querySelector("#form");
const materialsEl = document.querySelector("#materials");
const statsEl = document.querySelector("#stats");

let materials = [];
let editingId = null;

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
      '<div class="row"><h3>' + m.name + '</h3>' +
      (low ? '<span class="pill pending">库存不足</span>' : '<span class="pill active">库存正常</span>') +
      '</div>' +
      '<div class="meta">更新时间：' + m.updatedAt + '</div>' +
      '<div><b>当前库存</b> ' + m.quantity + ' ' + m.unit + '</div>' +
      '<div><b>低库存阈值</b> ' + m.lowStockThreshold + ' ' + m.unit + '</div>' +
      (low ? '<div class="danger">库存已低于预警阈值，请及时补充</div>' : '') +
      '<div class="actions">' +
      '<button class="secondary" data-edit="' + m.id + '">编辑</button>' +
      '<button class="danger" data-delete="' + m.id + '">删除</button>' +
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

load();
