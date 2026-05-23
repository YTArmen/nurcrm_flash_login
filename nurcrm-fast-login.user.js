// ==UserScript==
// @name         NurCRM Fast Login PRO
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Умный вход по ПИН/QR для NurCRM с защитой от автозаполнения браузера
// @match        *://*.nurcrm.kg/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 0. ЭКСТРЕННЫЙ СБРОС АДМИНКИ (Параметр ?nfast_reset_admin=1)
    if (window.location.search.includes('nfast_reset_admin=1')) {
        localStorage.setItem('nfast_admin_creds', JSON.stringify({ login: 'admin', pass: 'admin' }));
        alert('🚨 Аварийный сброс!\n\nДанные администратора успешно сброшены на дефолтные:\nЛогин: admin\nПароль: admin\n\nБаза сотрудников сохранена.');
        const url = new URL(window.location.href);
        url.searchParams.delete('nfast_reset_admin');
        window.history.replaceState({}, document.title, url.pathname);
    }

    // Загрузка данных из памяти
    let STAFF_DATABASE = JSON.parse(localStorage.getItem('nfast_staff')) || {};
    let ADMIN_CREDS = JSON.parse(localStorage.getItem('nfast_admin_creds')) || { login: 'admin', pass: 'admin' };
    let CURRENT_THEME = localStorage.getItem('nfast_theme') || 'light';

    let editingCode = null;

    // 1. СТИЛИ И ИНТЕРФЕЙС
    const html = `
    <style>
      :root {
        --nf-bg: #f8fafc;
        --nf-card-bg: #ffffff;
        --nf-text: #0f172a;
        --nf-text-muted: #64748b;
        --nf-border: #e2e8f0;
        --nf-accent: #3b82f6;
        --nf-accent-hover: #1d4ed8;
        --nf-danger: #ef4444;
        --nf-danger-hover: #b91c1c;
        --nf-success: #10b981;
        --nf-input-bg: #ffffff;
        --nf-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
      }
      .theme-dark {
        --nf-bg: #0f172a;
        --nf-card-bg: #1e293b;
        --nf-text: #f8fafc;
        --nf-text-muted: #94a3b8;
        --nf-border: #334155;
        --nf-accent: #3b82f6;
        --nf-accent-hover: #60a5fa;
        --nf-danger: #f87171;
        --nf-danger-hover: #ef4444;
        --nf-success: #34d399;
        --nf-input-bg: #1e293b;
        --nf-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.3);
      }

      #nfast-screen, #nfast-admin-modal { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: var(--nf-text); }
      #nfast-screen *, #nfast-admin-modal * { box-sizing: border-box; }

      #nfast-screen { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: var(--nf-bg); z-index: 999999; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: background 0.3s, opacity 0.3s; }
      .nfast-card { background: var(--nf-card-bg); padding: 40px 30px; border-radius: 12px; text-align: center; box-shadow: var(--nf-shadow); width: 340px; position: relative; border: 1px solid var(--nf-border); }

      .nfast-title { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: var(--nf-text); }
      .nfast-subtitle { font-size: 14px; color: var(--nf-text-muted); margin-bottom: 24px; }

      .nfast-dots { display: flex; justify-content: center; gap: 12px; margin: 24px 0; }
      .nfast-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--nf-border); transition: background 0.2s; }
      .nfast-dot.active { background: var(--nf-accent); }

      .nfast-btn { background: var(--nf-accent); color: #fff; border: none; padding: 11px; border-radius: 6px; cursor: pointer; width: 100%; font-weight: 500; font-size: 14px; transition: background 0.2s; margin-top: 10px; }
      .nfast-btn:hover { background: var(--nf-accent-hover); }
      .nfast-btn-secondary { background: transparent; color: var(--nf-text-muted); border: 1px solid var(--nf-border); }
      .nfast-btn-secondary:hover { background: var(--nf-border); color: var(--nf-text); }

      .nfast-theme-toggle { position: absolute; top: 20px; right: 20px; background: transparent; border: 1px solid var(--nf-border); color: var(--nf-text); border-radius: 6px; width: 36px; height: 36px; cursor: pointer; display: flex; align-items: center; justify-content: center; }

      #nfast-admin-modal { position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0,0,0,0.4) !important; display: none !important; align-items: center !important; justify-content: center !important; z-index: 1000000 !important; }
      .nfast-modal-content { background: var(--nf-card-bg) !important; padding: 30px; border-radius: 12px; width: 550px; max-width: 95%; max-height: 90vh; overflow-y: auto; border: 1px solid var(--nf-border); box-shadow: var(--nf-shadow); }

      .nfast-modal-header { font-size: 18px; font-weight: 600; margin-bottom: 20px; border-bottom: 1px solid var(--nf-border); padding-bottom: 10px; }
      .nfast-section-title { font-size: 14px; font-weight: 600; text-transform: uppercase; color: var(--nf-text-muted); margin: 20px 0 10px 0; }

      .nfast-form-grid { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; margin-bottom: 15px; }
      .nfast-input { background: var(--nf-input-bg) !important; color: var(--nf-text) !important; padding: 10px 12px; border: 1px solid var(--nf-border); border-radius: 6px; width: 100%; font-size: 14px; outline: none; }

      /* Хитрый камуфляж полей от автозаполнения Google Chrome */
      .nfast-pass-mask { -webkit-text-security: disc !important; text-security: disc !important; }

      .nfast-table-wrapper { border: 1px solid var(--nf-border); border-radius: 6px; overflow: hidden; margin-bottom: 20px; background: var(--nf-input-bg); }
      .nfast-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
      .nfast-table th { background: var(--nf-bg); padding: 10px 12px; color: var(--nf-text-muted); border-bottom: 1px solid var(--nf-border); }
      .nfast-table td { padding: 10px 12px; border-bottom: 1px solid var(--nf-border); }

      .btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 4px; border: none; cursor: pointer; }
      .btn-edit { background: var(--nf-accent); color: white; margin-right: 5px; }
      .btn-del { background: var(--nf-danger); color: white; }

      .nfast-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; border-top: 1px solid var(--nf-border); padding-top: 15px; background: transparent !important; }
      .nfast-shake { animation: nfast-shake-anim 0.4s; }
      @keyframes nfast-shake-anim { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
    </style>

    <div id="nfast-screen" class="theme-${CURRENT_THEME}">
      <button type="button" class="nfast-theme-toggle" id="nfast-theme-btn">🌓</button>
      <div class="nfast-card" id="nfast-card">
        <div class="nfast-title">Быстрый вход</div>
        <div class="nfast-subtitle" id="nfast-status">Приложите карту или QR-код</div>
        <div class="nfast-dots">
          <div class="nfast-dot"></div><div class="nfast-dot"></div><div class="nfast-dot"></div><div class="nfast-dot"></div>
        </div>
        <input type="text" id="nfast-clean-buffer" name="nfast-hidden-scan" autocomplete="off" autofocus style="position: absolute !important; left: -9999px !important; opacity: 0 !important; width: 1px !important; height: 1px !important;" />
        <button type="button" class="nfast-btn nfast-btn-secondary" id="nfast-reset-btn">Сбросить ввод</button>
        <button type="button" class="nfast-btn nfast-btn-secondary" id="nfast-admin-btn" style="margin-top: 15px;">Настройки</button>
      </div>
    </div>

    <div id="nfast-admin-modal" class="theme-${CURRENT_THEME}">
      <div class="nfast-modal-content">
        <div id="nfast-block-auth">
          <div class="nfast-modal-header">Доступ ограничен</div>
          <div style="margin-bottom: 15px; font-size:14px; color: var(--nf-text-muted);">Введите данные администратора.</div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <input type="text" id="ad-login" class="nfast-input" placeholder="Логин админа" autocomplete="off">
            <input type="text" id="ad-pass" class="nfast-input nfast-pass-mask" placeholder="Пароль админа" autocomplete="off">
            <button id="ad-enter-btn" class="nfast-btn" type="button">Войти в панель</button>
          </div>
          <div class="nfast-actions">
            <button id="ad-close-auth" class="nfast-btn nfast-btn-secondary" type="button" style="margin:0; width:auto;">Отмена</button>
          </div>
        </div>

        <div id="nfast-block-manage" style="display: none;">
          <div class="nfast-modal-header">Панель управления скриптом</div>
          <div class="nfast-section-title">Список сотрудников</div>
          <div class="nfast-table-wrapper">
            <table class="nfast-table" id="staff-table">
              <thead>
                <tr><th>Имя</th><th>Email в CRM</th><th>Код доступа</th><th>Действия</th></tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>

          <div class="nfast-section-title" id="form-title">Добавить нового сотрудника</div>
          <div class="nfast-form-grid">
            <input type="text" id="cust-name" class="nfast-input" placeholder="Имя сотрудника" autocomplete="off">
            <input type="text" id="cust-email" class="nfast-input" placeholder="Email в NurCRM" autocomplete="off">
            <input type="text" id="cust-pass" class="nfast-input nfast-pass-mask" placeholder="Пароль в NurCRM" autocomplete="off">
            <input type="text" id="cust-code" class="nfast-input" placeholder="ПИН или Текст QR" autocomplete="off">
          </div>
          <button id="save-staff-btn" class="nfast-btn" type="button" style="background: var(--nf-success);">Добавить</button>

          <div class="nfast-section-title">Безопасность панели</div>
          <div class="nfast-form-grid">
            <input type="text" id="change-ad-login" class="nfast-input" placeholder="Новый логин админа" autocomplete="off">
            <input type="text" id="change-ad-pass" class="nfast-input nfast-pass-mask" placeholder="Новый пароль админа" autocomplete="off">
          </div>
          <button id="save-admin-creds-btn" class="nfast-btn nfast-btn-secondary" type="button" style="font-size:12px; padding:6px;">Обновить данные админа</button>

          <div class="nfast-actions">
            <button id="ad-close-manage" class="nfast-btn nfast-btn-secondary" type="button" style="margin:0; width:auto; background: var(--nf-danger); color:white; border:none;">Закрыть</button>
          </div>
        </div>
      </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // 2. БИЗНЕС-ЛОГИКА
    function startAuthLogic() {
        const screen = document.getElementById('nfast-screen');
        const card = document.getElementById('nfast-card');
        const bufferInput = document.getElementById('nfast-clean-buffer');
        const dots = document.querySelectorAll('.nfast-dot');
        const statusText = document.getElementById('nfast-status');
        const resetBtn = document.getElementById('nfast-reset-btn');
        const adminBtn = document.getElementById('nfast-admin-btn');
        const themeBtn = document.getElementById('nfast-theme-btn');
        const adminModal = document.getElementById('nfast-admin-modal');

        const blockAuth = document.getElementById('nfast-block-auth');
        const blockManage = document.getElementById('nfast-block-manage');
        const adLogin = document.getElementById('ad-login');
        const adPass = document.getElementById('ad-pass');
        const adEnterBtn = document.getElementById('ad-enter-btn');

        const custName = document.getElementById('cust-name');
        const custEmail = document.getElementById('cust-email');
        const custPass = document.getElementById('cust-pass');
        const custCode = document.getElementById('cust-code');
        const saveStaffBtn = document.getElementById('save-staff-btn');
        const formTitle = document.getElementById('form-title');

        const changeAdLogin = document.getElementById('change-ad-login');
        const changeAdPass = document.getElementById('change-ad-pass');
        const saveAdminCredsBtn = document.getElementById('save-admin-creds-btn');

        setTimeout(() => {
            if (!document.querySelector('input[type="password"]')) {
                screen.style.display = 'none';
            } else {
                bufferInput.focus();
            }
        }, 400);

        themeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isLight = screen.classList.contains('theme-light');
            screen.className = isLight ? 'theme-dark' : 'theme-light';
            adminModal.className = isLight ? 'theme-dark' : 'theme-light';
            localStorage.setItem('nfast_theme', isLight ? 'dark' : 'light');
            bufferInput.focus();
        });

        let scanTimeout;
        bufferInput.addEventListener('input', () => {
            let val = bufferInput.value;
            dots.forEach((dot, index) => {
                if (index < val.length) dot.classList.add('active');
                else dot.classList.remove('active');
            });
            clearTimeout(scanTimeout);
            scanTimeout = setTimeout(() => {
                if (bufferInput.value.length >= 4) processLogin(bufferInput.value);
            }, 150);
        });

        bufferInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(scanTimeout);
                if (bufferInput.value) processLogin(bufferInput.value);
            }
        });

        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetInputState();
        });

        screen.addEventListener('click', () => {
            if (adminModal.style.display !== 'flex') bufferInput.focus();
        });

        function resetInputState() {
            bufferInput.value = '';
            dots.forEach(dot => dot.classList.remove('active'));
            bufferInput.focus();
        }

        function processLogin(code) {
            const user = STAFF_DATABASE[code];
            if (user) {
                statusText.innerText = `Вход: ${user.name}...`;
                const origEmail = document.querySelector('input[type="email"], #email');
                const origPass = document.querySelector('input[type="password"]');
                const origForm = origEmail ? origEmail.closest('form') : null;
                const submitBtn = origForm ? origForm.querySelector('button[type="submit"], input[type="submit"]') : null;

                if (origEmail && origPass) {
                    const forceSetValue = (el, val) => {
                        el.focus();
                        el.select();
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (setter) {
                            setter.call(el, '');
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            setter.call(el, val);
                        } else {
                            el.value = val;
                        }

                        // Имитируем глубокий ручной ввод для Vue/React реактивности
                        el.dispatchEvent(new Event('keydown', { bubbles: true }));
                        el.dispatchEvent(new Event('keypress', { bubbles: true }));
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('keyup', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    };

                    forceSetValue(origEmail, user.login);
                    forceSetValue(origPass, user.pass);

                    // Двойная страховка при быстрой смене аккаунтов (через 60мс)
                    setTimeout(() => {
                        if (origEmail.value !== user.login || origPass.value !== user.pass) {
                            forceSetValue(origEmail, user.login);
                            forceSetValue(origPass, user.pass);
                        }
                    }, 60);

                    screen.style.opacity = '0';
                    screen.style.pointerEvents = 'none';

                    setTimeout(() => {
                        if (submitBtn) {
                            submitBtn.click();
                        } else if (origForm) {
                            origForm.submit();
                        } else {
                            const enterBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('войти'));
                            if (enterBtn) enterBtn.click();
                        }
                    }, 350);
                }
            } else {
                card.classList.add('nfast-shake');
                resetInputState();
                setTimeout(() => card.classList.remove('nfast-shake'), 400);
            }
        }

        function renderStaffList() {
            const tbody = document.querySelector('#staff-table tbody');
            tbody.innerHTML = '';
            for (const [code, user] of Object.entries(STAFF_DATABASE)) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><b>${user.name}</b></td>
                    <td>${user.login}</td>
                    <td style="font-family:monospace; color:var(--nf-accent);">${code}</td>
                    <td>
                        <button class="btn-sm btn-edit" data-code="${code}">Ред.</button>
                        <button class="btn-sm btn-del" data-code="${code}">Уд.</button>
                    </td>
                `;
                tbody.appendChild(tr);
            }

            document.querySelectorAll('.btn-del').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const targetCode = e.target.getAttribute('data-code');
                    delete STAFF_DATABASE[targetCode];
                    localStorage.setItem('nfast_staff', JSON.stringify(STAFF_DATABASE));
                    if(editingCode === targetCode) resetForm();
                    renderStaffList();
                });
            });

            document.querySelectorAll('.btn-edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const targetCode = e.target.getAttribute('data-code');
                    const user = STAFF_DATABASE[targetCode];
                    editingCode = targetCode;
                    custName.value = user.name;
                    custEmail.value = user.login;
                    custPass.value = user.pass;
                    custCode.value = targetCode;
                    formTitle.innerText = `Редактирование кассира: ${user.name}`;
                    saveStaffBtn.innerText = 'Сохранить изменения';
                    saveStaffBtn.style.background = 'var(--nf-accent)';
                });
            });
        }

        function resetForm() {
            editingCode = null;
            custName.value = ''; custEmail.value = ''; custPass.value = ''; custCode.value = '';
            formTitle.innerText = 'Добавить нового сотрудника';
            saveStaffBtn.innerText = 'Добавить';
            saveStaffBtn.style.background = 'var(--nf-success)';
        }

        saveStaffBtn.addEventListener('click', () => {
            const name = custName.value.trim(), login = custEmail.value.trim(), pass = custPass.value.trim(), code = custCode.value.trim();
            if (!name || !login || !pass || !code) { alert('Заполните все поля!'); return; }
            if (editingCode && editingCode !== code) delete STAFF_DATABASE[editingCode];
            STAFF_DATABASE[code] = { name, login, pass };
            localStorage.setItem('nfast_staff', JSON.stringify(STAFF_DATABASE));
            resetForm(); renderStaffList();
        });

        saveAdminCredsBtn.addEventListener('click', () => {
            const newLog = changeAdLogin.value.trim(), newPas = changeAdPass.value.trim();
            if (newLog && newPas) {
                ADMIN_CREDS = { login: newLog, pass: newPas };
                localStorage.setItem('nfast_admin_creds', JSON.stringify(ADMIN_CREDS));
                alert('Данные админа успешно обновлены!');
                changeAdLogin.value = ''; changeAdPass.value = '';
            } else {
                alert('Заполните оба поля!');
            }
        });

        adminBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            adLogin.value = ''; adPass.value = '';
            blockAuth.style.display = 'block'; blockManage.style.display = 'none';
            adminModal.style.setProperty('display', 'flex', 'important');
            adLogin.focus();
        });

        adEnterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (adLogin.value.trim() === ADMIN_CREDS.login && adPass.value === ADMIN_CREDS.pass) {
                blockAuth.style.display = 'none'; blockManage.style.display = 'block';
                resetForm(); renderStaffList();
            } else {
                alert('Неверные данные администратора!');
                adPass.value = ''; adPass.focus();
            }
        });

        document.getElementById('ad-close-auth').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            adminModal.style.setProperty('display', 'none', 'important');
            bufferInput.focus();
        });

        document.getElementById('ad-close-manage').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            adminModal.style.setProperty('display', 'none', 'important');
            bufferInput.focus();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startAuthLogic);
    else startAuthLogic();
})();
