/**
 * Content script: добавляет кнопку «⚡ Подключить к Unity» рядом с текстовыми полями
 * (textarea, input[type=text/search], contenteditable) на любом сайте.
 */
'use strict';

(function () {
  const BTN_CLASS = 'ub-connect-btn';
  const PANEL_CLASS = 'ub-panel';
  let activePanel = null;

  // сообщаем background текущий URL
  try { chrome.runtime.sendMessage({ type: 'ub:setSite' }); } catch (e) {}

  function isTextField(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'email'].includes(t);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function getFieldText(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value;
    return el.innerText || '';
  }

  function setFieldText(el, text) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.innerText = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function makeButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = BTN_CLASS;
    b.textContent = '⚡ Unity';
    b.title = 'Отправить выделенный текст/поле в Unity через UnityBridge AI';
    return b;
  }

  function closePanel() {
    if (activePanel) { activePanel.remove(); activePanel = null; }
  }

  function openPanel(anchor, field) {
    closePanel();
    const panel = document.createElement('div');
    panel.className = PANEL_CLASS;
    panel.innerHTML = `
      <div class="ub-title">UnityBridge AI</div>
      <textarea class="ub-input" rows="3" placeholder="Что сделать в Unity? (напр.: создай куб на позиции 0,0,0)"></textarea>
      <div class="ub-row">
        <button class="ub-send">Отправить в Unity</button>
        <button class="ub-insert" title="Вставить ответ в поле">Вставить ответ в поле</button>
      </div>
      <div class="ub-result"></div>`;
    document.body.appendChild(panel);
    const rect = anchor.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(window.innerWidth - 340, rect.left + window.scrollX)) + 'px';
    panel.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    activePanel = panel;

    const input = panel.querySelector('.ub-input');
    const result = panel.querySelector('.ub-result');
    const send = panel.querySelector('.ub-send');
    const insert = panel.querySelector('.ub-insert');

    send.addEventListener('click', async () => {
      const prompt = input.value.trim();
      if (!prompt) { result.textContent = 'Введите запрос.'; result.className = 'ub-result err'; return; }
      send.disabled = true;
      result.textContent = 'Отправлено в Unity…';
      result.className = 'ub-result pending';
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'ub:prompt',
          text: getFieldText(field).slice(0, 100000),
          prompt,
          mode: 'ask',
        });
        if (res && res.ok) {
          result.textContent = res.result || '(пустой ответ)';
          result.className = 'ub-result ok';
          insert.disabled = false;
          insert.onclick = () => { setFieldText(field, (res.result || '')); closePanel(); };
        } else {
          result.textContent = 'Ошибка: ' + (res && res.error ? res.error : 'нет ответа от моста. Запустите программу UnityBridge AI.');
          result.className = 'ub-result err';
        }
      } catch (e) {
        result.textContent = 'Ошибка: ' + e.message;
        result.className = 'ub-result err';
      } finally {
        send.disabled = false;
      }
    });

    document.addEventListener('mousedown', function onDoc(e) {
      if (activePanel && !activePanel.contains(e.target)) { closePanel(); document.removeEventListener('mousedown', onDoc); }
    });
  }

  function attachTo(field) {
    if (field.dataset.ubAttached) return;
    field.dataset.ubAttached = '1';
    const btn = makeButton();
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(btn, field);
    });
    // оборачиваем поле в контейнер, если ещё не обёрнуто
    if (!field.parentElement || !field.parentElement.classList.contains('ub-wrap')) {
      const wrap = document.createElement('span');
      wrap.className = 'ub-wrap';
      wrap.style.position = 'relative';
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'flex-start';
      field.parentNode.insertBefore(wrap, field);
      wrap.appendChild(field);
      wrap.appendChild(btn);
    } else {
      field.parentElement.appendChild(btn);
    }
  }

  function scan(root) {
    const fields = (root || document).querySelectorAll('textarea, input[type="text"], input[type="search"], input[type="url"], input[type="email"], [contenteditable="true"]');
    fields.forEach((f) => { if (isTextField(f)) attachTo(f); });
  }

  scan(document);
  // следим за динамически добавленными полями (SPA вроде arena.ai)
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 1) {
          if (isTextField(n)) attachTo(n);
          else scan(n);
        }
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', closePanel, { passive: true });
})();
