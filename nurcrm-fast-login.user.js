// ==UserScript==
// @name         NurCRM Fast Login PRO
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Ультимативный быстрый вход по ПИН/QR для NurCRM со звуком, логами и бэкапом
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
    let LOGIN_HISTORY = JSON.parse(localStorage.getItem('nfast_history')) || [];

    let editingCode = null; 

    // Звуковой движок (Web Audio API)
    function playBeep(isSuccess) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            if (isSuccess) {
                osc.frequency.setValueAtTime(1000, ctx.currentTime);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                osc.start();
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
                osc.stop(ctx.currentTime + 0.08);
            } else {
                // Двойной сигнал ошибки
                osc.frequency.setValueAtTime(280, ctx.currentTime);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                osc.start();
                gain.gain.setValueAtTime(0.1, ctx.currentTime + 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
                osc.stop(ctx.currentTime + 0.2);
            }
        } catch(e) { console.log('Аудио контекст заблокирован браузером'); }
    }

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
      .nfast-modal-content { background: var(--nf-card-bg) !important; padding: 30px; border-radius: 12px; width: 620px; max-width: 95%; max-height: 90vh; overflow-y: auto; border: 1px solid var(--nf-border); box-shadow: var(--nf-shadow); }
      
      .nfast-modal-header { font-size: 18px; font-weight: 600; margin-bottom: 20px; border-bottom: 1px solid var(--nf-border); padding-bottom: 10px; }
      .nfast-section-title { font-size: 14px; font-weight: 600; text-transform: uppercase; color: var(--nf-text-muted); margin: 25px 0 10px 0; display: flex; justify-content: space-between; align-items: center; }
      
      .nfast-form-grid { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; margin-bottom: 15px; }
      .nfast-input { background: var(--nf-input-bg) !important; color: var(--nf-text) !important; padding: 10px 12px; border: 1px solid var(--nf-border); border-radius: 6px; width: 100%; font-size: 14px; outline: none; }
      
      .nfast-pass-mask { -webkit-text-security: disc !important; text-security: disc !important; }

      .nfast-table-wrapper { border: 1px solid var(--nf-border); border-radius: 6px; overflow: hidden; margin-bottom: 20px; background: var(--nf-input-bg); max-height: 180px; overflow-y: auto; }
      .nfast-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
      .nfast-table th { background: var(--nf-bg); padding: 10px 12px; color: var(--nf-text-muted); border-bottom: 1px solid var(--nf-border); position: sticky; top: 0; z-index: 2; }
      .nfast-table td { padding: 10px 12px; border-bottom: 1px solid var(--nf-border); }
      
      .btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 4px; border: none; cursor: pointer; }
      .btn-edit { background: var(--nf-accent); color: white; margin-right: 5px; }
      .btn-del { background: var(--nf-danger); color: white; }
      
      .nfast-flex-btns { display: flex; gap: 10px; margin-bottom: 15px; }
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
            <button id="ad-enter-btn" class="nfast-btn" type="button">Войти в panel</button>
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
          
          <div class="nfast-section-title">
            <span>История последних входов</span>
            <button id="clear-history-btn" class="btn-sm btn-del" style="font-size:11px; padding:3px 8px;">Очистить</button>
          </div>
          <div class="nfast-table-wrapper">
            <table class="nfast-table" id="history-table">
              <thead>
                <tr><th>Сотрудник</th><th>Время входа</th></tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>

          <div class="nfast-section-title">Резервное копирование базы</div>
          <div class="nfast-flex-btns">
            <button id="export-btn" class="nfast-btn nfast-btn-secondary" type="button" style="margin:0;">📥 Скачать бэкап (.json)</button>
            <button id="import-btn" class="nfast-btn nfast-btn-secondary" type="button" style="margin:0;">📤 Восстановить из файла</button>
            <input type="file" id="import-file-input" accept=".json" style="display:none;" />
          </div>

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

        // ЭЛЕМЕНТЫ ДЛЯ НОВЫХ ФИЧ
        const exportBtn = document.getElementById('export-btn');
        const importBtn = document.getElementById('import-btn');
        const importFileInput = document.getElementById('import-file-input');
        const clearHistoryBtn = document.getElementById('clear-history-btn');

        setTimeout(() => {
            if (!document.querySelector('input[type="password"]')) {
                screen.style.display = 'none';
            } else {
                bufferInput.focus();
            }
        }, 400);

        // ЖЕЛЕЗОБЕТОННЫЙ АВТОФОКУС (Защита от потери фокуса)
        bufferInput.addEventListener('blur', () => {
            if (adminModal.style.display !== 'flex' && screen.style.opacity !== '0' && screen.style.display !== 'none') {
                setTimeout(() => bufferInput.focus(), 15);
            }
        });

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
                playBeep(true); // Звук успеха
                statusText.innerText = `Вход: ${user.name}...`;

                // Запись в историю смен
                const now = new Date();
                const timeString = now.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
                LOGIN_HISTORY.unshift({ name: user.name, time: timeString });
                if (LOGIN_HISTORY.length > 50) LOGIN_HISTORY.pop();
                localStorage.setItem('nfast_history', JSON.stringify(LOGIN_HISTORY));

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
                        el.dispatchEvent(new Event('keydown', { bubbles: true }));
                        el.dispatchEvent(new Event('keypress', { bubbles: true }));
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('keyup', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    };

                    forceSetValue(origEmail, user.login);
                    forceSetValue(origPass, user.pass);

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
                playBeep(false); // Звук ошибки
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

        function renderHistoryList() {
            const tbody = document.querySelector('#history-table tbody');
            tbody.innerHTML = '';
            LOGIN_HISTORY.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td><b>${item.name}</b></td><td style="color:var(--nf-text-muted);">${item.time}</td>`;
                tbody.appendChild(tr);
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

        // ЛОГИКА ЭКСПОРТА БЭКАПА
        exportBtn.addEventListener('click', () => {
            const dataToExport = {
                staff: STAFF_DATABASE,
                admin: ADMIN_CREDS
            };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataToExport, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `nurcrm_fast_login_backup_${new Date().toISOString().slice(0,10)}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });

        // ЛОГИКА ИМПОРТА БЭКАПА
        importBtn.addEventListener('click', () => importFileInput.click());
        importFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    const parsed = JSON.parse(evt.target.result);
                    if (parsed.staff && parsed.admin) {
                        STAFF_DATABASE = parsed.staff;
                        ADMIN_CREDS = parsed.admin;
                        localStorage.setItem('nfast_staff', JSON.stringify(STAFF_DATABASE));
                        localStorage.setItem('nfast_admin_creds', JSON.stringify(ADMIN_CREDS));
                        alert('🎉 База успешно восстановлена!');
                        renderStaffList();
                    } else {
                        alert('Неверный формат файла резервной копии!');
                    }
                } catch(err) { alert('Ошибка при чтении файла бэкапа!'); }
            };
            reader.readAsText(file);
            importFileInput.value = ''; // очистка инпута
        });

        // ОЧИСТКА ИСТОРИИ ВХОДОВ
        clearHistoryBtn.addEventListener('click', () => {
            if(confirm('Очистить весь журнал входов сотрудников?')) {
                LOGIN_HISTORY = [];
                localStorage.setItem('nfast_history', JSON.stringify(LOGIN_HISTORY));
                renderHistoryList();
            }
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
                resetForm(); renderStaffList(); renderHistoryList();
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
