(function () {
    let modalElement = null;
    let modalInstance = null;

    function ensureModal() {
        if (modalElement) return modalElement;
        const markup = [
            '<div class="modal fade git-operation-modal" id="gitOperationModal" tabindex="-1" aria-hidden="true">',
            '  <div class="modal-dialog modal-dialog-centered">',
            '    <div class="modal-content">',
            '      <div class="modal-body">',
            '        <div class="git-operation-icon is-loading" data-role="icon" aria-hidden="true"><i class="fas fa-spinner fa-spin"></i></div>',
            '        <h5 class="mb-2" data-role="title"></h5>',
            '        <p class="git-operation-message" data-role="message"></p>',
            '        <details class="git-operation-details d-none" data-role="details-wrap">',
            '          <summary>查看技术详情</summary><pre data-role="details"></pre>',
            '        </details>',
            '      </div>',
            '      <div class="modal-footer justify-content-center d-none" data-role="footer">',
            '        <button type="button" class="btn btn-primary px-4" data-bs-dismiss="modal">确定</button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '</div>'
        ].join('');
        document.body.insertAdjacentHTML('beforeend', markup);
        modalElement = document.getElementById('gitOperationModal');
        modalInstance = new bootstrap.Modal(modalElement, { backdrop: 'static', keyboard: false });
        return modalElement;
    }

    function setButtonLoading(button, loading, label) {
        if (!button) return;
        if (loading) {
            if (!button.dataset.gitOriginalHtml) button.dataset.gitOriginalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (label || '处理中...');
            return;
        }
        if (button.dataset.gitOriginalHtml) {
            button.innerHTML = button.dataset.gitOriginalHtml;
            delete button.dataset.gitOriginalHtml;
        }
        button.disabled = false;
    }

    function render(type, title, message, details) {
        const modal = ensureModal();
        const icon = modal.querySelector('[data-role="icon"]');
        const footer = modal.querySelector('[data-role="footer"]');
        const detailsWrap = modal.querySelector('[data-role="details-wrap"]');
        modal.querySelector('[data-role="title"]').textContent = title;
        modal.querySelector('[data-role="message"]').textContent = message || '';
        icon.className = 'git-operation-icon is-' + type;
        icon.innerHTML = type === 'loading'
            ? '<i class="fas fa-spinner fa-spin"></i>'
            : type === 'success' ? '<i class="fas fa-check"></i>' : '<i class="fas fa-exclamation-triangle"></i>';
        footer.classList.toggle('d-none', type === 'loading');
        if (details) {
            modal.querySelector('[data-role="details"]').textContent = details;
            detailsWrap.classList.remove('d-none');
            detailsWrap.open = false;
        } else {
            detailsWrap.classList.add('d-none');
        }
    }

    function payloadFrom(error) {
        if (error && error.payload) return error.payload;
        if (error && typeof error === 'object' && (error.error || error.message)) return error;
        return { error: String(error || '未知错误') };
    }

    async function request(url, options) {
        const response = await fetch(url, options);
        let data;
        try {
            data = await response.json();
        } catch (parseError) {
            data = { success: false, error: 'HTTP ' + response.status + ': ' + response.statusText };
        }
        if (!response.ok || !data.success) {
            const error = new Error(data.error || data.message || '操作失败');
            error.payload = data;
            throw error;
        }
        return data;
    }

    window.GitOperationFeedback = {
        start(options) {
            const button = options.button || null;
            setButtonLoading(button, true, options.buttonLabel);
            render('loading', options.title, options.message, '');
            modalInstance.show();
            return {
                update(title, message) { render('loading', title, message, ''); },
                success(title, message, details) {
                    setButtonLoading(button, false);
                    render('success', title, message, details);
                },
                error(title, error) {
                    const payload = payloadFrom(error);
                    setButtonLoading(button, false);
                    render('error', title, payload.error || payload.message || '操作失败', payload.technical_details || '');
                }
            };
        },
        request: request
    };
})();
