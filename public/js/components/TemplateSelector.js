(function (global) {
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  class TemplateSelector {
    constructor(container, options = {}) {
      this.container = typeof container === 'string' ? document.querySelector(container) : container;
      this.options = {
        apiBase: '/api',
        onApply: null,
        onPreview: null,
        groupByCategory: true,
        showPreview: true,
        ...options
      };
      this.templates = [];
      this.selectedId = null;
      this._init();
    }

    _init() {
      this.container.innerHTML = `
        <label>从流程模板选择</label>
        <select class="ts-select"></select>
        <div class="ts-preview" style="display:none;"></div>
        <button type="button" class="secondary ts-view-detail" style="display:none;margin-top:8px;">查看模板详情</button>
      `;
      this.selectEl = this.container.querySelector('.ts-select');
      this.previewEl = this.container.querySelector('.ts-preview');
      this.viewDetailBtn = this.container.querySelector('.ts-view-detail');
      this.previewEl.className = 'template-preview ts-preview';
      this.selectEl.onchange = () => this._onSelect();
      this.viewDetailBtn.onclick = () => this._showDetailModal();
    }

    async load() {
      const res = await fetch(this.options.apiBase + '/templates');
      this.templates = await res.json();
      this.render();
    }

    setTemplates(templates) {
      this.templates = templates || [];
      this.render();
    }

    render() {
      if (this.templates.length === 0) {
        this.selectEl.innerHTML = '<option value="">暂无可用流程模板</option>';
        return;
      }

      if (this.options.groupByCategory) {
        const categories = [...new Set(this.templates.map(t => t.category))].sort();
        let html = '<option value="">选择流程模板自动填充</option>';
        for (const cat of categories) {
          html += `<optgroup label="${escapeHtml(cat)}">`;
          const catTemplates = this.templates.filter(t => t.category === cat);
          for (const t of catTemplates) {
            html += `<option value="${t.id}">${escapeHtml(t.name)}（v${t.version}·预计${t.estimatedDays}天）</option>`;
          }
          html += '</optgroup>';
        }
        this.selectEl.innerHTML = html;
      } else {
        this.selectEl.innerHTML =
          '<option value="">选择流程模板自动填充</option>' +
          this.templates.map(t =>
            `<option value="${t.id}">${escapeHtml(t.name)}（${escapeHtml(t.category)}·v${t.version}·预计${t.estimatedDays}天）</option>`
          ).join('');
      }
    }

    _onSelect() {
      const templateId = this.selectEl.value;
      this.selectedId = templateId || null;
      if (!templateId) {
        this.previewEl.style.display = 'none';
        this.viewDetailBtn.style.display = 'none';
        if (this.options.onApply) this.options.onApply(null);
        return;
      }
      const template = this.templates.find(t => t.id === templateId);
      if (!template) return;

      const today = new Date();
      today.setDate(today.getDate() + template.estimatedDays);
      const dueDate = today.toISOString().slice(0, 10);

      if (this.options.showPreview) {
        let previewHtml =
          '<b>模板：</b>' + escapeHtml(template.name) + '（v' + template.version + '）<br>' +
          '<b>类型：</b>' + escapeHtml(template.category) + '<br>' +
          '<b>预计工期：</b>' + template.estimatedDays + '天 → 预计完成 <b>' + dueDate + '</b><br>' +
          '<b>复核：</b>' + (template.reviewRequired ? '需要' : '不需要');
        if (template.reviewRequired && template.reviewNotes) {
          previewHtml += '<br><b>复核要求：</b>' + escapeHtml(template.reviewNotes);
        }
        previewHtml += '<br><span class="meta" style="margin-top:6px;display:block;">已自动填充步骤、材料和预计完成日期，仍可手动修改</span>';
        this.previewEl.innerHTML = previewHtml;
        this.previewEl.style.display = 'block';
        this.viewDetailBtn.style.display = 'inline-block';
      }

      if (this.options.onApply) {
        this.options.onApply({
          template,
          applied: {
            steps: template.steps,
            materials: template.materials,
            dueDate,
            reviewRequired: template.reviewRequired
          }
        });
      }
    }

    async _showDetailModal() {
      if (!this.selectedId) return;
      const template = this.templates.find(t => t.id === this.selectedId);
      if (!template) return;

      let versionsHtml = '';
      try {
        const res = await fetch(this.options.apiBase + '/templates/' + this.selectedId + '/versions');
        if (res.ok) {
          const versions = await res.json();
          if (versions.length > 0) {
            versionsHtml = `
              <div style="margin-top:16px;padding-top:12px;border-top:1px dashed #d8d2c7;">
                <div style="font-weight:700;margin-bottom:8px;">版本历史</div>
                <div style="max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
                  ${versions.map(v => `
                    <div style="background:#faf7f0;border-radius:4px;padding:6px 10px;font-size:12px;">
                      <b>v${v.version}</b> · ${escapeHtml(v.operator || '系统')} · ${escapeHtml(v.createdAt)}
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }
        }
      } catch (e) {}

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content">
          <div class="modal-header">
            <h3>${escapeHtml(template.name)}</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="detail-row"><span class="detail-label">藏品类型</span><span>${escapeHtml(template.category)}</span></div>
            <div class="detail-row"><span class="detail-label">当前版本</span><span>v${template.version}</span></div>
            <div class="detail-row"><span class="detail-label">预计工期</span><span>${template.estimatedDays}天</span></div>
            <div class="detail-row"><span class="detail-label">是否复核</span><span>${template.reviewRequired ? '需要' : '不需要'}</span></div>
            ${template.reviewNotes ? `<div class="detail-row"><span class="detail-label">复核要求</span><span>${escapeHtml(template.reviewNotes)}</span></div>` : ''}
            <div style="margin-top:12px;">
              <div style="font-weight:700;margin-bottom:6px;">默认步骤</div>
              <div class="template-steps">${escapeHtml(template.steps)}</div>
            </div>
            <div style="margin-top:12px;">
              <div style="font-weight:700;margin-bottom:6px;">建议材料</div>
              <div>${escapeHtml(template.materials)}</div>
            </div>
            ${versionsHtml}
          </div>
          <div class="modal-actions">
            <button class="secondary" data-action="close">关闭</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const close = () => modal.remove();
      modal.querySelector('.modal-overlay').onclick = close;
      modal.querySelector('.modal-close').onclick = close;
      modal.querySelector('[data-action="close"]').onclick = close;
    }

    getValue() {
      return this.selectedId;
    }

    reset() {
      this.selectEl.value = '';
      this.selectedId = null;
      this.previewEl.style.display = 'none';
      this.viewDetailBtn.style.display = 'none';
    }
  }

  global.TemplateSelector = TemplateSelector;
})(window);
