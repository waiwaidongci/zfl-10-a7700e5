const viewer = document.querySelector("#viewer");
const form = document.querySelector("#form");
const projectsEl = document.querySelector("#projects");
const statsEl = document.querySelector("#stats");
const intakeSelect = document.querySelector("#intakeSelect");
const intakeInfo = document.querySelector("#intakeInfo");
const materialCheckboxes = document.querySelector("#materialCheckboxes");
const stockHint = document.querySelector("#stockHint");

let users = [];
let projects = [];
let intakes = [];
let materials = [];

async function api(path, options) {
  const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
  return res.json();
}

function isOverdue(project) {
  return project.status !== "已完成" && new Date(project.dueDate) < new Date(new Date().toISOString().slice(0, 10));
}

function render() {
  const user = users.find((item) => item.id === viewer.value) || users[0];
  const visible = user.role === "admin" ? projects : projects.filter((item) => item.owner === user.name);
  const active = projects.filter((item) => item.status !== "已完成").length;
  const overdue = projects.filter(isOverdue).length;
  const workload = projects.reduce((map, item) => {
    map[item.owner] = (map[item.owner] || 0) + 1;
    return map;
  }, {});

  statsEl.innerHTML =
    '<div class="stat"><span>进行中</span><strong>' + active + '</strong></div>' +
    '<div class="stat"><span>逾期</span><strong>' + overdue + '</strong></div>' +
    '<div class="stat"><span>负责人工作量</span><strong>' +
    Object.entries(workload).map(([k, v]) => k + v).join(" / ") +
    '</strong></div>';

  projectsEl.innerHTML = visible.map((p) => {
    const cls = isOverdue(p) ? 'overdue' : '';
    return (
      '<article class="' + cls + '">' +
      '<div class="row"><h3>' + p.title + '</h3><span class="pill">' + p.status + '</span></div>' +
      '<div class="meta">' + p.era + ' · ' + p.owner + ' · ' + p.dueDate + '</div>' +
      '<div><b>破损</b> ' + p.damage + '</div>' +
      '<div><b>步骤</b> ' + p.steps + '</div>' +
      '<div><b>材料</b> ' + p.materials + '</div>' +
      (isOverdue(p) ? '<div class="danger">已超过预计完成日期</div>' : '') +
      '<select data-id="' + p.id + '">' +
      '<option>进行中</option>' +
      '<option>待复核</option>' +
      '<option>已完成</option>' +
      '</select>' +
      '</article>'
    );
  }).join("");

  document.querySelectorAll("article select").forEach((select) => {
    const project = projects.find((item) => item.id === select.dataset.id);
    select.value = project.status;
    select.onchange = async () => {
      await api('/api/projects/' + project.id, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
      await load();
    };
  });
}

function renderIntakeOptions() {
  const pendingIntakes = intakes.filter((i) => i.status === "待修复");
  if (pendingIntakes.length === 0) {
    intakeSelect.innerHTML = '<option value="">暂无可选入库记录</option>';
    return;
  }
  intakeSelect.innerHTML =
    '<option value="">选择入库记录带入信息</option>' +
    pendingIntakes.map((i) => '<option value="' + i.id + '">' + i.title + '（' + i.era + '）</option>').join("");
}

function onIntakeChange() {
  const intakeId = intakeSelect.value;
  if (!intakeId) {
    intakeInfo.style.display = 'none';
    return;
  }
  const intake = intakes.find((i) => i.id === intakeId);
  if (!intake) return;

  form.title.value = intake.title;
  form.era.value = intake.era || '';
  form.damage.value = intake.damage || '';

  intakeInfo.innerHTML =
    '<b>来源：</b>' + intake.source + '<br>' +
    '<b>接收人：</b>' + intake.receiver + '<br>' +
    '<b>接收时间：</b>' + intake.receivedAt + '<br>' +
    '<b>存放位置：</b>' + intake.tempLocation;
  intakeInfo.style.display = 'block';
}

function renderMaterialCheckboxes() {
  if (materials.length === 0) {
    materialCheckboxes.innerHTML = '<span style="font-size: 13px; color: #6b6258;">暂无库存材料</span>';
    return;
  }
  materialCheckboxes.innerHTML = materials.map((m) => {
    const low = m.quantity <= m.lowStockThreshold;
    const cls = low ? 'low-stock' : '';
    return (
      '<label class="' + cls + '">' +
      '<input type="checkbox" value="' + m.id + '" data-name="' + m.name + '">' +
      m.name + '（' + m.quantity + m.unit + '）' +
      '</label>'
    );
  }).join('');

  materialCheckboxes.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.onchange = onMaterialChange;
  });
}

function onMaterialChange() {
  const selected = [];
  const selectedMaterials = [];

  materialCheckboxes.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
    const material = materials.find((m) => m.id === cb.value);
    if (material) {
      selected.push(material.name);
      selectedMaterials.push(material);
    }
  });

  if (selected.length > 0) {
    const currentValue = form.materials.value;
    if (!currentValue || currentValue.trim() === '') {
      form.materials.value = selected.join('、');
    } else {
      const existingMaterials = currentValue.split(/[、,，]/).map(s => s.trim()).filter(s => s);
      const merged = [...new Set([...existingMaterials, ...selected])];
      form.materials.value = merged.join('、');
    }
  }

  updateStockHint(selectedMaterials);
}

function updateStockHint(selectedMaterials) {
  if (selectedMaterials.length === 0) {
    stockHint.style.display = 'none';
    return;
  }

  const lowStockItems = selectedMaterials.filter(m => m.quantity <= m.lowStockThreshold);

  let html = '<b>已选材料库存：</b><br>';
  selectedMaterials.forEach((m) => {
    const low = m.quantity <= m.lowStockThreshold;
    html += '· ' + m.name + '：' + m.quantity + m.unit;
    if (low) {
      html += ' <span class="low">（库存不足）</span>';
    }
    html += '<br>';
  });

  if (lowStockItems.length > 0) {
    html += '<br><span class="low">注意：有 ' + lowStockItems.length + ' 种材料库存不足，请及时补充</span>';
  }

  stockHint.innerHTML = html;
  stockHint.style.display = 'block';
}

async function load() {
  users = await api("/api/users");
  projects = await api("/api/projects");
  intakes = await api("/api/intakes");
  materials = await api("/api/materials");

  viewer.innerHTML = users.map((u) => '<option value="' + u.id + '">' + u.name + ' · ' + u.role + '</option>').join("");
  if (!viewer.value) viewer.value = users[0].id;

  renderIntakeOptions();
  renderMaterialCheckboxes();
  render();
}

viewer.onchange = render;
intakeSelect.onchange = onIntakeChange;

form.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  delete data.intakeId;
  await api("/api/projects", { method: "POST", body: JSON.stringify(data) });
  form.reset();
  intakeInfo.style.display = 'none';
  stockHint.style.display = 'none';
  await load();
};

load();
