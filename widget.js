(function(){
  // Widget version - increment this when making changes
  const WIDGET_VERSION = '5.0.0';
  
  if (window.VFW_LOADED) {
    return;
  }
  window.VFW_LOADED = true;
  
  const CONFIG = {
    openaiEndpoint: '/api/chat',
    gasEndpoint: 'https://script.google.com/macros/s/AKfycbyJg7_2DnyoROYCl_TrH4G7jzHTUD8MJnVy7Suf62o4m7zOA9nzPqKSP_pmUKXFaV3T7w/exec',
    promptUrl: './Промпт.json',
    catalogUrl: './Каталог.json',
    triggerMinIntervalMs: 60_000,
    pageThreshold: 2,
    brand: { accent: '#6C5CE7', bg: '#ffffff', text: '#111', radius: 16 }
  };

  // Read configuration from script dataset
  (function(){
    try{
      const current = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      if (!current) return;
      CONFIG.promptUrl = current.dataset.prompt || CONFIG.promptUrl;
      CONFIG.catalogUrl = current.dataset.catalog || CONFIG.catalogUrl;
      CONFIG.gasEndpoint = current.dataset.gas || CONFIG.gasEndpoint;
      if (current.dataset.api) CONFIG.openaiEndpoint = current.dataset.api;
      
      if (current.dataset.promptContent) CONFIG.promptContent = current.dataset.promptContent;
      if (current.dataset.catalogContent) CONFIG.catalogContent = current.dataset.catalogContent;
      
      if (CONFIG.promptUrl && !CONFIG.promptUrl.includes('v=')) CONFIG.promptUrl += '?v=' + WIDGET_VERSION;
      if (CONFIG.catalogUrl && !CONFIG.catalogUrl.includes('v=')) CONFIG.catalogUrl += '?v=' + WIDGET_VERSION;
    }catch(e){}
  })();

  function getOrSetSessionId(){
    const key='vf_session_id';
    const m=document.cookie.match(/(?:^|; )vf_session_id=([^;]+)/);
    if (m) return m[1];
    const id = 's_'+Math.random().toString(36).slice(2)+Date.now().toString(36);
    document.cookie=`${key}=${id}; path=/; max-age=${60*60*24*365}`;
    return id;
  }
  const SESSION_ID = getOrSetSessionId();

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function disableScroll() {
    if (isMobile()) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.height = '100%';
    }
  }

  function enableScroll() {
    if (isMobile()) {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
    }
  }


  const style = document.createElement('style');
  style.textContent = `
    /* Основные стили виджета */
    .vfw-root {
      position: fixed;
      right: 60px;
      bottom: 60px;
      z-index: 999999;
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    
    .vfw-btn {
      width: 84px;
      height: 84px;
      border-radius: 50%;
      background: ${CONFIG.brand.text};
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 24px rgba(0,0,0,.16);
      cursor: pointer;
      transition: transform .12s ease;
      border: none;
      touch-action: manipulation;
    }
    
    .vfw-btn:hover {
      transform: translateY(-2px);
    }
    
    .vfw-btn:active {
      transform: translateY(0px);
    }
    
    /* Индикатор онлайн */
    .vfw-online-indicator {
      position: absolute;
      bottom: 2px;
      right: 2px;
      width: 18px;
      height: 18px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);
    }
    
    /* Основная панель виджета */
    .vfw-panel {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 424px;
      max-width: 584px;
      min-width: 344px;
      height: 90vh;
      max-height: 90vh;
      background: #fff;
      border-radius: ${CONFIG.brand.radius}px;
      box-shadow: 0 24px 64px rgba(0,0,0,.20);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(17,17,17,.06);
      z-index: 999999;
      box-sizing: border-box;
      transform: translateY(100%);
      opacity: 0;
      transition: all 0.3s ease;
      visibility: hidden;
    }
    
    .vfw-panel[data-open="1"] {
      transform: translateY(0);
      opacity: 1;
      visibility: visible;
    }
    
    /* Мобильные стили */
    @media (max-width: 768px) {
      .vfw-root {
        right: 20px;
        bottom: 20px;
      }
      
      .vfw-btn {
        width: 96px;
        height: 96px;
        box-shadow: 0 8px 32px rgba(0,0,0,.25);
      }
      
      .vfw-online-indicator {
        width: 20px;
        height: 20px;
      }
      
      .vfw-panel {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: calc(var(--vh, 1vh) * 100);
        max-width: none;
        min-width: auto;
        max-height: calc(var(--vh, 1vh) * 100);
        border-radius: 0;
        padding-top: env(safe-area-inset-top, 0);
        padding-bottom: env(safe-area-inset-bottom, 0);
        padding-left: env(safe-area-inset-left, 0);
        padding-right: env(safe-area-inset-right, 0);
      }
    }
    
    @media (max-width: 480px) {
      .vfw-root {
        right: 16px;
        bottom: 16px;
      }
      
      .vfw-btn {
        width: 88px;
        height: 88px;
      }
    }
    
    /* Заголовок виджета */
    .vfw-header {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(17,17,17,.06);
      display: flex;
      align-items: center;
      gap: 10px;
      justify-content: space-between;
      flex-shrink: 0;
    }
    
    .vfw-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: ${CONFIG.brand.accent};
      box-shadow: 0 0 0 6px rgba(108,92,231,.15);
    }
    
    .vfw-title {
      font-weight: 600;
    }
    
    .vfw-actions {
      display: flex;
      gap: 8px;
    }
    
    .vfw-iconbtn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid rgba(17,17,17,.12);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      background: #fff;
      flex-shrink: 0;
    }
    
    .vfw-iconbtn svg {
      width: 18px;
      height: 18px;
      stroke: #111;
      stroke-width: 2;
    }
    
    @media (max-width: 768px) {
      .vfw-iconbtn {
        width: 44px;
        height: 44px;
      }
      
      .vfw-iconbtn svg {
        width: 20px;
        height: 20px;
      }
    }
    
    /* Тело чата */
    .vfw-body {
      flex: 1;
      overflow: auto;
      background: #fafafa;
      padding: 12px;
    }
    
    .vfw-msg {
      display: flex;
      margin: 16px 0;
    }
    
    .vfw-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      overflow: hidden;
      margin-right: 8px;
      flex: 0 0 28px;
      border: 1px solid rgba(17,17,17,.08);
    }
    
    .vfw-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .vfw-msg .bubble {
      max-width: 78%;
      padding: 10px 12px;
      border-radius: 14px;
      line-height: 1.3;
      border: 1px solid rgba(17,17,17,.06);
      font-size: 15px;
    }
    
    .vfw-msg .bubble .vfw-link {
      color: #1976d2;
      text-decoration: underline;
      cursor: pointer;
      transition: color 0.2s ease;
    }
    
    .vfw-msg .bubble .vfw-link:hover {
      color: #0d47a1;
      text-decoration: underline;
    }
    
    .vfw-msg.bot .bubble {
      background: #f1f2f2;
    }
    
    .vfw-msg.user {
      justify-content: flex-end;
    }
    
    .vfw-msg.user .bubble {
      background: #1f2428;
      color: #fff;
      border: none;
    }
    
    /* Поле ввода */
    .vfw-compose {
      padding: 10px;
      border-top: 1px solid rgba(17,17,17,.06);
      background: #fff;
      flex-shrink: 0;
    }
    
    .vfw-pill {
      display: flex;
      align-items: center;
      border: 2px solid #1e1e1e;
      border-radius: 9999px;
      padding: 6px 6px 6px 14px;
    }
    
    .vfw-pill input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 15px;
      color: #111;
    }
    
    .vfw-pill input::placeholder {
      color: #9aa0a6;
    }
    
    .vfw-sendbtn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #e9eaee;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    
    .vfw-sendbtn svg {
      stroke: #3c4043;
      width: 18px;
      height: 18px;
    }
    
    .vfw-pill.active .vfw-sendbtn {
      background: #1e1e1e;
    }
    
    .vfw-pill.active .vfw-sendbtn svg {
      stroke: #fff;
    }
    
    @media (max-width: 768px) {
      .vfw-pill input {
        font-size: 16px;
        padding: 12px 16px;
      }
      
      .vfw-sendbtn {
        width: 48px;
        height: 48px;
      }
      
      .vfw-sendbtn svg {
        width: 20px;
        height: 20px;
      }
    }
    
    /* Футер */
    .vfw-footer {
      padding: 8px 10px 0;
      text-align: center;
    }
    
    .vfw-developer-link {
      color: #999;
      text-decoration: none;
      font-size: 11px;
      transition: all 0.2s ease;
    }
    
    .vfw-developer-link:hover {
      color: #999;
      text-decoration: underline;
    }
    
    /* Подтверждение закрытия */
    .vfw-confirm {
      display: none;
      padding: 8px 10px;
      border-top: 1px solid rgba(17,17,17,.06);
      background: #fff;
      gap: 8px;
      flex-direction: column;
    }
    
    .vfw-confirm[data-show="1"] {
      display: flex;
    }
    
    .vfw-confirm button {
      flex: 1;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid rgba(17,17,17,.12);
      cursor: pointer;
      font-size: 16px;
    }
    
    .vfw-confirm .danger {
      background: #dc3545;
      color: #fff;
      border-color: #dc3545;
      order: -1;
    }
    
    .vfw-disc {
      font-size: 12px;
      color: #666;
      margin: 6px 0;
    }
    
    /* Индикатор печати */
    .vfw-typing {
      display: flex;
      margin: 8px 0;
      align-items: flex-end;
    }
    
    .vfw-typing .bubble {
      max-width: 78%;
      padding: 10px 12px;
      border-radius: 14px;
      line-height: 1.3;
      border: 1px solid rgba(17,17,17,.06);
      font-size: 15px;
      background: #f1f2f2;
      position: relative;
    }
    
    .vfw-typing-dots {
      display: flex;
      gap: 4px;
      margin-top: 4px;
    }
    
    .vfw-typing-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #999;
      animation: typing 1.4s infinite;
    }
    
    .vfw-typing-dot:nth-child(2) {
      animation-delay: .2s;
    }
    
    .vfw-typing-dot:nth-child(3) {
      animation-delay: .4s;
    }
    
    @keyframes typing {
      0%, 60%, 100% { transform: translateY(0); opacity: .5; }
      30% { transform: translateY(-8px); opacity: 1; }
    }
    
    /* Всплывающие подсказки */
    .vfw-hints {
      position: fixed;
      right: 60px;
      bottom: 160px;
      display: none;
      flex-direction: column;
      gap: 20px;
      z-index: 999998;
      align-items: flex-end;
      opacity: 0;
      transform: translateY(30px);
      transition: all 0.6s cubic-bezier(0.2,0.8,0.2,1);
    }
    
    .vfw-hints[data-show="1"] {
      display: flex;
      opacity: 1;
      transform: translateY(0);
    }
    
    .vfw-hint {
      max-width: min(25vw, 560px);
      min-width: 200px;
      background: #fff;
      color: #111;
      border-radius: 22px;
      padding: 12px 40px 12px 12px;
      box-shadow: 0 18px 48px rgba(0,0,0,.25);
      font-size: 15px;
      line-height: 1.35;
      border: 1px solid rgba(17,17,17,.06);
      text-align: left;
      opacity: 1;
      transform: translateY(0);
      transition: all 0.4s cubic-bezier(0.2,0.8,0.2,1);
      position: relative;
    }
    
    .vfw-hint-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(0,0,0,0.1);
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      opacity: 0.7;
    }
    
    .vfw-hint-close:hover {
      background: rgba(0,0,0,0.2);
      opacity: 1;
      transform: scale(1.1);
    }
    
    .vfw-hint-close svg {
      stroke: #111;
      stroke-width: 2;
      width: 14px;
      height: 14px;
    }
    
    .vfw-hint-content {
      padding-right: 0px;
    }
    
    @media (max-width: 768px) {
      .vfw-hint {
        max-width: calc(100vw - 80px);
        min-width: 200px;
      }
      
      .vfw-hints {
        right: 20px;
        bottom: 140px;
      }
    }
    
    @media (max-width: 480px) {
      .vfw-hints {
        right: 16px;
        bottom: 120px;
      }
    }
    
    /* Предотвращение zoom на iOS */
    @media screen and (-webkit-min-device-pixel-ratio: 0) {
      select, textarea, input[type="text"], input[type="password"], 
      input[type="datetime"], input[type="datetime-local"], 
      input[type="date"], input[type="month"], input[type="time"], 
      input[type="week"], input[type="number"], input[type="email"], 
      input[type="url"], input[type="search"], input[type="tel"], 
      input[type="color"] {
        font-size: 16px;
      }
    }
    
    /* Button loading states */
    button:disabled {
      opacity: 0.6 !important;
      cursor: not-allowed !important;
      pointer-events: none;
    }
    
    button:not(:disabled):hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    button:not(:disabled):active {
      transform: translateY(0);
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'vfw-root';
  root.innerHTML = `
    <button class="vfw-btn" id="vfwBtn" aria-label="Открыть чат" style="position:relative">
      <img src="./images/consultant.jpg" alt="Консультант" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.3);">
      <span class="vfw-online-indicator"></span>
    </button>
    <div class="vfw-hints" id="vfwHints">
      <div class="vfw-hint" id="vfwHintSingle">
        <button class="vfw-hint-close" id="vfwHintClose" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <div class="vfw-hint-content">
          Привет! ✋<br>Я онлайн и готов помочь с выбором мебели!
        </div>
      </div>
    </div>
    <div class="vfw-panel" id="vfwPanel" role="dialog" aria-modal="true">
      <div class="vfw-header">
        <div style="display:flex;align-items:center;gap:10px">
          <img src="./images/consultant.jpg" alt="Аватар" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid rgba(17,17,17,.1)">
          <div class="vfw-title">Евгений, ваш консультант</div>
        </div>
        <div class="vfw-actions">
          <button class="vfw-iconbtn" id="vfwMin" aria-label="Свернуть">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke-linecap="round"/></svg>
          </button>
          <button class="vfw-iconbtn" id="vfwClose" aria-label="Закрыть">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
      <div class="vfw-body" id="vfwBody"></div>
      <div class="vfw-confirm" id="vfwConfirm">
        <button id="vfwEnd" class="danger">Завершить диалог</button>
        <button id="vfwCancel">Отмена</button>
      </div>
      <div class="vfw-compose">
        <div class="vfw-pill" id="vfwPill">
          <input id="vfwInput" placeholder="Сообщение...">
          <button id="vfwSend" class="vfw-sendbtn" aria-label="Отправить">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M19 12l-6-6M19 12l-6 6" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="vfw-footer">
          <a href="https://1ma.ai/platform" target="_blank" rel="noopener noreferrer" class="vfw-developer-link">
            Powered by 1ma
          </a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  
  function updateVH() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }
  updateVH();
  window.addEventListener('resize', () => {
    updateVH();
    requestAnimationFrame(() => {
      const body = document.getElementById('vfwBody');
      body.scrollTop = body.scrollHeight;
    });
  });
  window.addEventListener('orientationchange', updateVH);
  
  window.visualViewport?.addEventListener('resize', () => {
    const panel = document.querySelector('.vfw-panel');
    if (!panel) return;
    
    if (!isMobile()) return;
    
    const vh = window.visualViewport.height;
    const windowHeight = window.innerHeight;
    
    // Более точное определение открытия клавиатуры
    const keyboardOpen = vh < windowHeight * 0.75;
    
    if (keyboardOpen) {
      // Когда клавиатура открыта, устанавливаем фиксированную высоту
      const availableHeight = Math.max(vh * 0.9, 400);
      panel.style.height = availableHeight + 'px';
      panel.style.maxHeight = availableHeight + 'px';
      
      // Позиционируем панель так, чтобы поле ввода было видно
      const inputRect = document.getElementById('vfwInput').getBoundingClientRect();
      
      // Если поле ввода слишком высоко, корректируем позицию
      if (inputRect.top < 100) {
        const offset = Math.max(0, 100 - inputRect.top);
        panel.style.transform = `translateY(-${offset}px)`;
      }
    } else {
      // Когда клавиатура закрыта, возвращаем нормальные стили
      panel.style.height = '';
      panel.style.maxHeight = '';
      panel.style.transform = '';
    }
  });
  
  const input = document.getElementById('vfwInput');
  input.addEventListener('focus', () => {
    // Увеличиваем задержку для более стабильной работы
    setTimeout(() => {
      const body = document.getElementById('vfwBody');
      if (body) {
        body.scrollTo({
          top: body.scrollHeight,
          behavior: 'smooth'
        });
      }
      
      // Дополнительная проверка позиции панели при фокусе
      const panel = document.querySelector('.vfw-panel');
      if (panel && isMobile()) {
        const vh = window.visualViewport?.height || window.innerHeight;
        const windowHeight = window.innerHeight;
        
        if (vh < windowHeight * 0.75) {
          const availableHeight = Math.max(vh * 0.9, 400);
          panel.style.height = availableHeight + 'px';
          panel.style.maxHeight = availableHeight + 'px';
        }
      }
    }, 300); // Увеличиваем задержку для более стабильной работы
  });
  
  root.style.display = 'block';
  root.style.visibility = 'visible';
  root.style.opacity = '1';

  const els = {
    root: root,
    btn: root.querySelector('#vfwBtn'),
    panel: root.querySelector('#vfwPanel'),
    body: root.querySelector('#vfwBody'),
    input: root.querySelector('#vfwInput'),
    send: root.querySelector('#vfwSend'),
    pill: root.querySelector('#vfwPill'),
    min: root.querySelector('#vfwMin'),
    close: root.querySelector('#vfwClose'),
    confirm: root.querySelector('#vfwConfirm'),
    end: root.querySelector('#vfwEnd'),
    cancel: root.querySelector('#vfwCancel'),
    hints: root.querySelector('#vfwHints'),
    hintSingle: root.querySelector('#vfwHintSingle'),
    hintClose: root.querySelector('#vfwHintClose')
  };

  function openPanel(){
    els.panel.setAttribute('data-open','1');
    disableScroll();
  }

  function closePanel(){ 
    els.panel.removeAttribute('data-open');
    enableScroll();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    let html = div.innerHTML.replace(/\n/g, '<br>');
    
    // Преобразуем ссылки nm-shop.by в кликабельные ссылки
    const urlRegex = /(https?:\/\/nm-shop\.by[^\s<]*?)(?=\.|<br>|<|$)/gi;
    html = html.replace(urlRegex, (match) => {
      // Убираем точку в конце URL если она есть
      const cleanUrl = match.replace(/\.$/, '');
      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="vfw-link">${match}</a>`;
    });
    
    return html;
  }

  function addMsg(role, text){
    const row=document.createElement('div'); 
    row.className='vfw-row';
    
    if (role==='bot'){
      row.innerHTML = `<div class="vfw-msg bot"><div class="vfw-avatar"><img src="./images/consultant.jpg" alt="bot"></div><div class="bubble"></div></div>`;
    } else {
      row.innerHTML = `<div class="vfw-msg user"><div class="bubble"></div></div>`;
    }
    
    const safeText = escapeHtml(text);
    row.querySelector('.bubble').innerHTML = safeText;
    els.body.appendChild(row);
    
    setTimeout(() => {
      const isAtBottom = els.body.scrollTop + els.body.clientHeight >= els.body.scrollHeight - 10;
      if (isAtBottom) {
        els.body.scrollTop = els.body.scrollHeight;
      } else {
        const messageRect = row.getBoundingClientRect();
        const bodyRect = els.body.getBoundingClientRect();
        if (messageRect.bottom > bodyRect.bottom) {
          row.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      }
    }, 100);
  }
  
  function addConsultationButtons() {
    const buttons = [
      { text: 'Здесь в чате', icon: '💬' },
      { text: 'Звонок дизайнера', icon: '📞' }
    ];
    
    // Create container for horizontal layout
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 8px 36px;justify-content:flex-start';
    
    buttons.forEach(buttonData => {
      const button = document.createElement('button');
      button.className = 'consultation-btn';
      button.dataset.text = buttonData.text;
      button.style.cssText = `
        padding:10px 16px;
        border:none;
        border-radius:14px;
        background:#e3f2fd;
        color:#1976d2;
        cursor:pointer;
        font-size:14px;
        font-weight:500;
        transition:all 0.2s ease;
        white-space:nowrap;
        flex-shrink:0;
        min-height:44px;
      `;
      button.innerHTML = `${buttonData.icon} ${buttonData.text}`;
      
      // Hover effects
      button.addEventListener('mouseenter', () => {
        button.style.background = '#bbdefb';
        button.style.color = '#0d47a1';
        button.style.transform = 'translateY(-1px)';
      });
      
      button.addEventListener('mouseleave', () => {
        button.style.background = '#e3f2fd';
        button.style.color = '#1976d2';
        button.style.transform = 'translateY(0)';
      });
      
      // Click handler
      button.addEventListener('click', () => {
        container.remove(); // Remove all consultation buttons
        
        if (buttonData.text === 'Здесь в чате') {
          addMsg('bot', 'Отлично! Задавайте любые вопросы, постараюсь помочь!');
        } else if (buttonData.text === 'Звонок дизайнера') {
          bypassFormPause = true; // Обходим паузу для кнопок
          addMsg('bot', 'Отлично! Дизайнер перезвонит и проконсультирует по всем вопросам. Оставьте ваши контакты:');
          setTimeout(() => {
            renderConsultationForm();
          }, 1000);
        }
      });
      
      container.appendChild(button);
    });
    
    els.body.appendChild(container);
    
    // Smart scrolling for consultation buttons
    setTimeout(() => {
      const isAtBottom = els.body.scrollTop + els.body.clientHeight >= els.body.scrollHeight - 10;
      if (isAtBottom) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }

  // Quick action buttons after welcome message
  function addQuickButtons() {
    const buttons = [
      { text: 'Хочу подарок', icon: '🎁' },
      { text: 'Записаться в шоурум', icon: '🏪' },
      { text: 'Нужна консультация', icon: '💬' }
    ];
    
    // Create container for horizontal layout
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 8px 36px;justify-content:flex-start';
    
    buttons.forEach(buttonData => {
      const button = document.createElement('button');
      button.className = 'quick-btn';
      button.dataset.text = buttonData.text;
      button.style.cssText = `
        padding:10px 16px;
        border:none;
        border-radius:14px;
        background:#e3f2fd;
        color:#1976d2;
        cursor:pointer;
        font-size:14px;
        font-weight:500;
        transition:all 0.2s ease;
        white-space:nowrap;
        flex-shrink:0;
        min-height:44px;
      `;
      button.innerHTML = `${buttonData.icon} ${buttonData.text}`;
      
      // Hover effects
      button.addEventListener('mouseenter', () => {
        button.style.background = '#bbdefb';
        button.style.color = '#0d47a1';
        button.style.transform = 'translateY(-1px)';
      });
      
      button.addEventListener('mouseleave', () => {
        button.style.background = '#e3f2fd';
        button.style.color = '#1976d2';
        button.style.transform = 'translateY(0)';
      });
      
      // Click handler
      button.addEventListener('click', () => {
        container.remove(); // Remove all quick buttons
        
        if (buttonData.text === 'Хочу подарок') {
          // Для кнопки "Хочу подарок" сразу показываем форму
          bypassFormPause = true; // Обходим паузу для кнопок
          renderForm('Выберите подарок и оставьте контакты!', [
            { type: 'offer' },
            { id: 'name', placeholder: 'Имя', required: true },
            { id: 'phone', placeholder: 'Телефон (+375...)', required: true }
          ], 'Получить подарок');
        } else if (buttonData.text === 'Записаться в шоурум') {
          // Для записи в шоурум - сообщение + форма
          bypassFormPause = true; // Обходим паузу для кнопок
          addMsg('bot', 'Подскажите пожалуйста в каком городе находитесь и ваш номер телефона, передам дизайнеру в шоу-руме и он с вами свяжется');
          setTimeout(() => {
            renderShowroomForm();
          }, 1000);
        } else if (buttonData.text === 'Нужна консультация') {
          // Для консультации - показываем кнопки выбора
          addMsg('bot', 'Конечно! Как вам удобнее получить консультацию?');
          setTimeout(() => {
            addConsultationButtons();
          }, 500);
        }
      });
      
      container.appendChild(button);
    });
    
    els.body.appendChild(container);
    
    // Smart scrolling for quick buttons
    setTimeout(() => {
      const isAtBottom = els.body.scrollTop + els.body.clientHeight >= els.body.scrollHeight - 10;
      if (isAtBottom) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }
  
  function showTyping(){
    const typingRow = document.createElement('div');
    typingRow.className = 'vfw-typing';
    typingRow.innerHTML = `
      <div class="vfw-avatar"><img src="./images/consultant.jpg" alt="bot"></div>
      <div class="bubble">
        <div class="vfw-typing-dots">
          <div class="vfw-typing-dot"></div>
          <div class="vfw-typing-dot"></div>
          <div class="vfw-typing-dot"></div>
        </div>
      </div>
    `;
    els.body.appendChild(typingRow);
    els.body.scrollTop = els.body.scrollHeight;
    return typingRow;
  }
  
  function hideTyping(typingRow){
    if (typingRow && typingRow.parentNode) {
      typingRow.parentNode.removeChild(typingRow);
    }
  }

  function nowIso(){ return new Date().toISOString(); }
  function normalizePhone(input){
    if (!input) return null;
    const raw = String(input).trim();
    let s = raw.replace(/[\s\-()]/g, '');
    if (s.startsWith('00')) s = '+' + s.slice(2);
    if (!s.startsWith('+') && /^\d{7,15}$/.test(s)) s = '+' + s;
    if (!/^\+\d{6,15}$/.test(s)) return null;
    return s;
  }

  let CATALOG = null;
  let PROMPT = null;
  const submittedLeads = new Set();
  let fallbackFormShown = false; // Флаг для отслеживания показа fallback формы
  let widgetOpenedInSession = false; // Флаг для отслеживания первого открытия виджета в сессии
  let lastFormShownAt = 0; // Время последнего показа формы
  let userMessagesAfterLastForm = 0; // Количество сообщений пользователя после последней формы
  let bypassFormPause = false; // Флаг обхода паузы для форм от кнопок быстрых действий

  // Функция для локальной обработки сообщений без API
  function generateLocalReply(userMessage, prompt, catalog) {
    const message = userMessage.toLowerCase();
    
    // Простые ответы на основе ключевых слов
    if (message.includes('привет') || message.includes('здравствуйте') || message.includes('добр')) {
      return 'Здравствуйте! Я консультант по мебели. Помогу подобрать идеальную мебель для вашего дома. Какая мебель вас интересует?';
    }
    
    if (message.includes('диван') || message.includes('кровать') || message.includes('шкаф') || message.includes('кухня') || message.includes('мебель') || message.includes('купить')) {
      return 'Отлично! У нас есть широкий ассортимент мебели:\n\n• Диваны - от 450 BYN\n• Кровати - от 380 BYN\n• Шкафы - от 520 BYN\n• Кухни - от 1500 BYN\n\nКакой тип мебели вас интересует?';
    }
    
    if (message.includes('цена') || message.includes('стоимость') || message.includes('сколько')) {
      return 'Цены на нашу мебель:\n\n• Диваны: от 450 BYN\n• Кровати: от 380 BYN\n• Шкафы: от 520 BYN\n• Кухни: от 1500 BYN\n\nЕсть подарок при заказе от 1500 BYN! Хотите узнать подробности?';
    }
    
    if (message.includes('подарок') || message.includes('акция') || message.includes('скидка')) {
      return 'У нас есть специальные предложения:\n\n🎁 Журнальный стол в подарок при заказе дивана от 1500 BYN\n🎁 Кухонный стол в подарок при заказе кухни от 1500 BYN\n🎁 Бесплатная консультация дизайнера\n\nОставьте телефон, и наш менеджер расскажет подробности!';
    }
    
    if (message.includes('телефон') || message.includes('номер') || message.includes('связать')) {
      return 'Конечно! Оставьте ваш номер телефона, и наш менеджер перезвонит в течение 2 часов в рабочее время. Мы поможем подобрать идеальную мебель!';
    }
    
    // Общий ответ
    return 'Спасибо за ваш вопрос! Я консультант по мебели. Расскажите, какая мебель вас интересует? Могу предложить несколько вариантов с ценами и характеристиками.';
  }

  async function fetchPromptAndCatalog(){
    // Use inline content if available, otherwise fetch from URLs
    let promptPromise, catalogPromise;
    
    if (CONFIG.promptContent) {
      promptPromise = Promise.resolve(JSON.parse(CONFIG.promptContent));
    } else {
      promptPromise = CONFIG.promptUrl ? fetch(CONFIG.promptUrl, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }).then(r=>r.json()) : Promise.resolve(null);
    }
    
    if (CONFIG.catalogContent) {
      catalogPromise = Promise.resolve(parseCatalogContent(CONFIG.catalogContent));
    } else {
      // Используем API каталога вместо статического файла
      catalogPromise = fetch(CONFIG.openaiEndpoint.replace('/chat', '/catalog'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        body: JSON.stringify({
          action: 'stats' // Получаем базовую информацию о каталоге
        })
      }).then(async r => {
        if (!r.ok) {
          console.warn('Failed to load catalog from API, using empty catalog');
          return null;
        }
        const data = await r.json();
        if (!data.success) {
          console.warn('Catalog API returned error:', data);
          return null;
        }
        return {
          offers: [],  // Оставляем пустым, товары будут загружаться динамически
          categories: data.categories || {},
          totalCount: data.totalOffers || 0,
          timestamp: data.lastUpdate || new Date().toISOString()
        };
      }).catch(e => {
        console.error('Failed to load catalog:', e);
        return null;
      });
    }
    
    const [p, c] = await Promise.allSettled([promptPromise, catalogPromise]);
    PROMPT = p.status==='fulfilled' ? p.value : null;
    CATALOG = c.status==='fulfilled' ? c.value : null;
    
    // Initialize session on server with prompt and catalog
    if (PROMPT && CATALOG && CONFIG.openaiEndpoint) {
      fetch(CONFIG.openaiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          session_id: SESSION_ID,
          prompt: PROMPT,
          catalog: CATALOG,
          locale: 'ru'
        })
      }).catch(e => {
        console.warn('Failed to initialize session:', e);
      });
    }
  }
  
  function parseCatalogContent(txt) {
    const isXML = /<\?xml|<yml_catalog/.test(txt);
    if (isXML){
      const dom = new DOMParser().parseFromString(txt, 'text/xml');
      const offers = Array.from(dom.querySelectorAll('offer')).map(of=>{
        return {
          id: of.getAttribute('id'),
          name: of.querySelector('name')?.textContent?.trim(),
          vendor: of.querySelector('vendor')?.textContent?.trim(),
          url: of.querySelector('url')?.textContent?.trim(),
          price: of.querySelector('price')?.textContent?.trim(),
          currency: of.querySelector('currencyId')?.textContent?.trim(),
          description: of.querySelector('description')?.textContent?.trim(),
          mechanism: of.querySelector('mechanism')?.textContent?.trim(),
          colors: of.querySelector('colors')?.textContent?.trim()
        };
      });
      return { offers };
    } else {
      return JSON.parse(txt);
    }
  }


  function incPageViews(){
    const k='vfw_pv'; const n = +(sessionStorage.getItem(k)||'0')+1;
    sessionStorage.setItem(k, String(n));
    return n;
  }

  function watchSpaRouting(){
    ['popstate','hashchange'].forEach(ev=> window.addEventListener(ev, ()=>{
      incPageViews();
      schedulePageCountTrigger();
    }));
    const push = history.pushState;
    history.pushState = function(){
      push.apply(this, arguments);
      window.dispatchEvent(new Event('popstate'));
    };
    const replace = history.replaceState;
    history.replaceState = function(){
      replace.apply(this, arguments);
      window.dispatchEvent(new Event('popstate'));
    };
  }

  function setupExitIntent() {
    let mouseY = 0;
    
    document.addEventListener('mousemove', (e) => {
      mouseY = e.clientY;
    });
    
    document.addEventListener('mouseleave', (e) => {
      if (e.clientY <= 0) {
        handleExitIntent();
      }
    });
    
    document.addEventListener('mousemove', (e) => {
      if (e.clientY <= 50 && e.clientX > 0 && e.clientX < window.innerWidth) {
        handleExitIntent();
      }
    });
  }

  let lastTriggerAt = 0;
  function canTrigger(){ return Date.now() - lastTriggerAt > CONFIG.triggerMinIntervalMs; }
  function markTriggered(){ lastTriggerAt = Date.now(); }

  let hintsAutoHideTimer = null;
  let hintsCooldownTimer = null;
  let exitIntentTriggered = false;
  
  function showHintsWithAutoHide(text) {
    
    if (hintsAutoHideTimer) { clearTimeout(hintsAutoHideTimer); hintsAutoHideTimer = null; }
    if (hintsCooldownTimer) { clearTimeout(hintsCooldownTimer); hintsCooldownTimer = null; }
    
    if (els.hintSingle) {
      const hintContent = els.hintSingle.querySelector('.vfw-hint-content');
      if (hintContent) {
        hintContent.textContent = text;
      }
    }
    
    setTimeout(() => {
      els.hints.setAttribute('data-show','1');
    }, 100);
    
    hintsAutoHideTimer = setTimeout(() => {
      hideHints();
      startHintsCooldown();
    }, 15000);
  }
  
  function showExitIntentHints() {
    
    if (hintsAutoHideTimer) { clearTimeout(hintsAutoHideTimer); hintsAutoHideTimer = null; }
    if (hintsCooldownTimer) { clearTimeout(hintsCooldownTimer); hintsCooldownTimer = null; }
    
    if (els.hintSingle) {
      const hintContent = els.hintSingle.querySelector('.vfw-hint-content');
      if (hintContent) {
        hintContent.textContent = 'Перед тем как уйти — хочу предложить вам подарок на выбор 🎁';
      }
    }
    
    setTimeout(() => {
      els.hints.setAttribute('data-show','1');
    }, 100);
    
    hintsAutoHideTimer = setTimeout(() => {
      hideHints();
      startHintsCooldown();
    }, 20000);
  }
  
  function hideHints() {
    els.hints.removeAttribute('data-show');
    if (hintsAutoHideTimer) { clearTimeout(hintsAutoHideTimer); hintsAutoHideTimer = null; }
  }
  
  function startHintsCooldown() {
    hintsCooldownTimer = setTimeout(() => {
      hintsCooldownTimer = null;
    }, 15000);
  }
  
  function canShowHints() {
    return !hintsCooldownTimer && !els.hints.getAttribute('data-show');
  }
  
  function handleExitIntent() {
    if (els.panel.getAttribute('data-open') !== '1' && !exitIntentTriggered) {
      hideHints();
      showExitIntentHints();
      exitIntentTriggered = true;
    }
  }


  function schedulePageCountTrigger(){
    const n = incPageViews();
    if (n >= CONFIG.pageThreshold && canTrigger()){
      // Use IntersectionObserver for page count trigger too
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && els.panel.getAttribute('data-open') !== '1' && canShowHints()) {
            showHintsWithAutoHide('Привет! ✋\nЯ онлайн и готов помочь с выбором мебели!');
            markTriggered();
            observer.disconnect();
          }
        });
      }, {
        threshold: 0.5,
        rootMargin: '0px'
      });
      
      if (els.btn) {
        observer.observe(els.btn);
      }
    }
  }

  const STORAGE_KEY = 'vfw_chat_history';
  function loadHistory(){
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'[]'); } catch(e){ return []; }
  }
  function saveHistory(x){ sessionStorage.setItem(STORAGE_KEY, JSON.stringify(x).slice(0, 200_000)); }
  
  // Clear history on page unload
  window.addEventListener('beforeunload', ()=>{
    sessionStorage.removeItem(STORAGE_KEY);
  });

  // Timeout helper function
  function timeout(ms) {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timeout')), ms)
    );
  }

  // Функция для retry запросов с таймаутом
  async function fetchWithRetry(url, options, maxRetries = 2) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await Promise.race([
          fetch(url, options),
          timeout(30000)
        ]);
        return res;
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Экспоненциальная задержка
      }
    }
  }

  async function sendToModel(userText){
    if (!navigator.onLine) {
      const offlineMessage = 'Похоже, нет подключения к интернету. Попробуйте позже.';
      addMsg('bot', offlineMessage);
      return offlineMessage;
    }

    const history = loadHistory();
    history.push({ role:'user', content:userText, ts: nowIso() });
    saveHistory(history);

    const userMessages = history.filter(m => m.role === 'user').length;
    const shouldBeAggressive = userMessages >= 2 && userMessages <= 4;
    
    const payload = {
      action: 'chat',
      session_id: SESSION_ID,
      user_message: userText,
      history_tail: history.slice(-5).map(m => ({ role: m.role, content: m.content })),
      aggressive_mode: shouldBeAggressive,
      user_messages_after_last_form: userMessagesAfterLastForm
    };
    
    // Если нет API endpoint, используем локальную обработку
    if (!CONFIG.openaiEndpoint) {
      const reply = generateLocalReply(userText, PROMPT, CATALOG);
      return { reply, formMessage: null };
    }
    
    try {
      const res = await fetchWithRetry(CONFIG.openaiEndpoint, {
        method:'POST',
        headers:{ 
          'Content-Type':'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      let data;
      try{
        data = await res.json();
      }catch(e){ 
        data = null; 
      }
      
      if (!res.ok){
        // Если ошибка 400 и сессия не инициализирована - пробуем инициализировать
        if (res.status === 400) {
          const errorData = await res.json().catch(() => ({}));
          if (errorData.error && errorData.error.includes('Session not initialized')) {
            console.log('Session not initialized, trying to reinitialize...');
            // Пробуем инициализировать сессию еще раз
            await fetchPromptAndCatalog();
            // Повторяем запрос
            const retryRes = await fetchWithRetry(CONFIG.openaiEndpoint, {
              method:'POST',
              headers:{ 
                'Content-Type':'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(payload)
            });
            
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              const text = retryData.reply || 'Здравствуйте! Я консультант по диванам. Чем могу помочь?';
              history.push({ role:'assistant', content:text, ts: nowIso() });
              saveHistory(history);
              
              if (retryData.formMessage) {
                history.push({ role:'assistant', content:retryData.formMessage, ts: nowIso() });
                saveHistory(history);
              }
              
              return { text, formMessage: retryData.formMessage, needsForm: retryData.needsForm };
            }
          }
        }
        
        // Сервер вернул ошибку HTTP
        const errorMessage = 'Извините, система временно недоступна. Оставьте телефон и наш дизайнер перезвонит вам, а я закреплю за вами подарок 🎁';
        
        // НЕ добавляем сообщение здесь - оно будет добавлено в submitUser
        return { text: errorMessage, needsForm: true, formType: 'gift' };
      }
      
      // Проверяем, если сервер вернул сообщение об ошибке (даже со статусом 200)
      if (data?.reply && data.reply.includes('система временно недоступна')) {
        const errorMessage = data.reply;
        
        // НЕ добавляем сообщение здесь - оно будет добавлено в submitUser
        return { text: errorMessage, needsForm: data.needsForm || true, formType: data.formType || 'gift' };
      }
      
      const text = data.reply || 'Здравствуйте! Я консультант по диванам. Чем могу помочь?';
      history.push({ role:'assistant', content:text, ts: nowIso() });
      saveHistory(history);
      
      // Если есть персонализированное сообщение с формой, сохраняем его
      if (data.formMessage) {
        history.push({ role:'assistant', content:data.formMessage, ts: nowIso() });
        saveHistory(history);
      }
      
      return { text, formMessage: data.formMessage, needsForm: data.needsForm };
      
    } catch (error) {
      // Показываем fallback форму только если она еще не была показана в этой сессии
      if (!fallbackFormShown) {
        fallbackFormShown = true; // Устанавливаем флаг сразу
        // Добавляем сообщение о проблеме
        const errorMessage = 'Извините, система временно недоступна. Оставьте телефон и наш дизайнер перезвонит вам, а я закреплю за вами подарок 🎁';
        
        // НЕ добавляем сообщение здесь - оно будет добавлено в submitUser
        return { text: errorMessage, needsForm: true, formType: 'gift' };
      } else {
        // Если форма уже была показана, показываем обычное сообщение
        const fallbackText = 'Система временно недоступна. Попробуйте позже.';
        return fallbackText;
      }
    }
  }

  // Обработчики событий
  els.btn.addEventListener('click', async ()=>{
    if (els.panel.getAttribute('data-open')==='1'){ closePanel(); return; }
    openPanel();
    hideHints();
    startHintsCooldown();
    // Сбрасываем флаг exit-intent при открытии панели
    exitIntentTriggered = false;
    
    // Показываем приветствие СРАЗУ без ожидания загрузки данных
    if (!widgetOpenedInSession) {
      widgetOpenedInSession = true;
      // Сбрасываем флаг fallback формы при начале новой сессии
      fallbackFormShown = false;
      
      // Показываем приветствие мгновенно
      addMsg('bot', 'Здравствуйте! Я консультант по мебели. Чем могу помочь?');
      
      // Сохраняем приветственное сообщение в историю
      const history = loadHistory();
      history.push({ role: 'assistant', content: 'Здравствуйте! Я консультант по мебели. Чем могу помочь?', ts: nowIso() });
      saveHistory(history);
      
      // Добавляем быстрые кнопки действий мгновенно
      setTimeout(() => addQuickButtons(), 100);
      
      // Загружаем данные в фоне, если они еще не загружены
      if (!PROMPT || !CATALOG) {
        fetchPromptAndCatalog().catch(e => {
          console.warn('Failed to load prompt/catalog:', e);
        });
      }
    } else {
      // Восстанавливаем историю чата
      els.body.innerHTML='';
      for (const m of loadHistory().slice(-10)){
        addMsg(m.role==='user'?'user':'bot', m.content);
      }
      
      // Восстанавливаем кнопки-подсказки если приветственное сообщение есть в истории
      const history = loadHistory();
      const welcomeMessage = history.find(m => m.role === 'assistant' && m.content === 'Здравствуйте! Я консультант по мебели. Чем могу помочь?');
      if (welcomeMessage) {
        // Проверяем, что после приветствия нет других сообщений от бота
        const messagesAfterWelcome = history.slice(history.indexOf(welcomeMessage) + 1);
        const hasBotMessagesAfter = messagesAfterWelcome.some(m => m.role === 'assistant');
        if (!hasBotMessagesAfter) {
          // Показываем кнопки-подсказки
          setTimeout(() => addQuickButtons(), 100);
        }
      }
      
      // Восстанавливаем форму если она была предложена
      const lastBotMessage = loadHistory().filter(m => m.role === 'assistant').slice(-1)[0];
      if (lastBotMessage && shouldShowForm(lastBotMessage.content)) {
        // Проверяем паузу между показами форм (минимум 3 реплики клиента)
        const isDirectRequest = isDirectFormRequest(lastBotMessage.content);
        if (!bypassFormPause && !isDirectRequest && lastFormShownAt > 0 && userMessagesAfterLastForm < 3) {
          // Пауза не прошла - не показываем форму
          return;
        }
        
        renderForm('Выберите подарок и оставьте контакты!', [
          { type: 'offer' },
          { id: 'name', placeholder: 'Имя', required: true },
          { id: 'phone', placeholder: 'Телефон (+375...)', required: true }
        ], 'Получить подарок');
      }
    }
  });

  els.min.addEventListener('click', ()=>{ closePanel(); });
  els.close.addEventListener('click', ()=>{ els.confirm.setAttribute('data-show','1'); });
  els.cancel.addEventListener('click', ()=>{ els.confirm.removeAttribute('data-show'); });
  els.end.addEventListener('click', ()=>{ 
    sessionStorage.removeItem(STORAGE_KEY); 
    els.confirm.removeAttribute('data-show'); 
    closePanel(); 
    // Clear chat history from UI
    els.body.innerHTML = '';
    // Сбрасываем флаг fallback формы при завершении диалога
    fallbackFormShown = false;
    // Сбрасываем флаг открытия виджета для показа приветствия при следующем открытии
    widgetOpenedInSession = false;
    enableScroll(); // Дополнительно разблокируем скролл при завершении диалога
  });

  if (els.hintClose){ 
    els.hintClose.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      hideHints();
      startHintsCooldown();
    }); 
  }

  els.send.addEventListener('click', submitUser);
  els.input.addEventListener('input', ()=>{ if (els.input.value.trim()) els.pill.classList.add('active'); else els.pill.classList.remove('active'); });
  els.input.addEventListener('keydown', (e)=>{ if (e.key==='Enter') submitUser(); });

  async function submitUser(){
    const v = els.input.value.trim(); if (!v) return;
    els.input.value='';
    
    // Reset button state after sending
    els.pill.classList.remove('active');
    
    addMsg('user', v);
    
    // Увеличиваем счетчик сообщений пользователя после последней формы
    if (lastFormShownAt > 0) {
      userMessagesAfterLastForm++;
      console.log('User message sent, counter increased:', userMessagesAfterLastForm);
    }
    
    // Если пользователь отправил сообщение, а форма была предложена, значит он её проигнорировал
    if (document.querySelector('#vfwName') || document.querySelector('#vfwPhone') || document.querySelector('#vfwPhoneQuick')) {
      // Удаляем форму
      const forms = document.querySelectorAll('#vfwName, #vfwPhone, #vfwPhoneQuick');
      forms.forEach(form => {
        if (form.closest('.vfw-msg')) {
          form.closest('.vfw-msg').remove();
        }
      });
    }
    
    
    // Show typing indicator
    const typingRow = showTyping();
    
    try {
      const response = await sendToModel(v);
      hideTyping(typingRow);
      
      // Обрабатываем ответ в зависимости от формата
      if (typeof response === 'string') {
        // Старый формат - просто текст
        addMsg('bot', response);
        maybeOfferPhoneFlow(response);
      } else if (response && response.text) {
        // Новый формат - объект с текстом и формой
        addMsg('bot', response.text);
        
        // Если есть персонализированное сообщение с формой
        if (response.formMessage) {
          addMsg('bot', response.formMessage);
          
          // Проверяем паузу между показами форм (минимум 3 реплики клиента)
          console.log('Form pause check:', { lastFormShownAt, userMessagesAfterLastForm, bypassFormPause });
          const isDirectRequest = isDirectFormRequest(response.formMessage);
          if (!bypassFormPause && !isDirectRequest && lastFormShownAt > 0 && userMessagesAfterLastForm < 3) {
            // Пауза не прошла - не показываем форму, только сообщение бота
            console.log('Form paused - not showing form');
            return;
          }
          
          // Проверяем, это запрос на шоурум или обычная форма
          const showroomKeywords = ['шоурум', 'шоу-рум', 'шоуруме', 'дизайнеру в шоу-руме'];
          const isShowroomRequest = showroomKeywords.some(keyword => response.formMessage.toLowerCase().includes(keyword));
          
          if (isShowroomRequest) {
            // Показываем форму записи в шоурум
            renderShowroomForm();
          } else {
            // Показываем обычную форму с подарками
            renderForm(response.formMessage, [
              { type: 'offer' },
              { id: 'name', placeholder: 'Имя', required: true },
              { id: 'phone', placeholder: 'Телефон (+375...)', required: true }
            ], 'Получить подарок');
          }
        } else if (response.needsForm && response.formType === 'gift') {
          // Показываем форму с подарком при ошибке AI (только если она еще не была показана)
          if (!fallbackFormShown) {
            // Проверяем паузу между показами форм (минимум 3 реплики клиента)
            const isDirectRequest = isDirectFormRequest(response.text);
            if (!bypassFormPause && !isDirectRequest && lastFormShownAt > 0 && userMessagesAfterLastForm < 3) {
              // Пауза не прошла - не показываем форму
              return;
            }
            
            fallbackFormShown = true;
            renderForm('Выберите подарок и оставьте контакты!', [
              { type: 'offer' },
              { id: 'name', placeholder: 'Имя', required: true },
              { id: 'phone', placeholder: 'Телефон (+375...)', required: true }
            ], 'Получить подарок');
          }
        } else if (response.needsForm) {
          // Показываем стандартную форму
          maybeOfferPhoneFlow(response.text);
        }
      }
    } catch(e) {
      hideTyping(typingRow);
      // Не показываем дополнительное сообщение, так как sendToModel уже обработал ошибку
    }
  }

  
  // Shared form trigger patterns
  const FORM_TRIGGERS = [
    /(скидк|запис|подушк|дизайн|консульт)/i,
    /(понравилось|беру|хочу такой|хочу этот)/i,
    /(цен|стоимост|бюджет|сколько стоит|дорог|дешев)/i,
    /(доставк|срок|когда|быстро|время)/i,
    /(сомнева|думаю|подозр|не уверен|колеблюсь)/i,
    /(посмотрю|ещё|друг|альтернатив|вариант)/i,
    /(подумаю|решу|определюсь|выберу)/i,
    /(телефон|номер|контакт|связаться|позвонить)/i,
    /(оставьте|оставить|записать|запись)/i,
    /(форма|заполните|заполнить|данные в форме)/i,
    /(закрепить|закрепления|акции)/i,
    /(диван|мебель|покупк|заказ|интересно|нравится|подходит|подойдет)/i,
    /(подарок|выберите|выбор|акция|спецпредложение)/i,
    /(оставите телефон|оставить телефон|дайте телефон|дайте номер)/i,
    /(спецпредложение|специальное предложение)/i,
    /(закреплю|закреплю за вами)/i,
    /(10%|скидка|специальная)/i,
    /(рассрочк|рассрочку|рассрочка|рассрочки)/i,
    /(размер|размеры|конструкц|кастомизац|измен|под заказ)/i
  ];
  
  // Прямые просьбы заполнить форму (обход паузы)
  const DIRECT_FORM_REQUESTS = [
    /форм/i,  // любое упоминание слова "форма"
    /записать|запишу|записаться/i,
    /забронировать|закрепить/i,
    /оставь|оставить|дайте/i,
    /контакт|телефон|номер/i,
    /оформлени/i,  // "оформления", "оформление"
    /отправ/i  // "отправил", "отправить"
  ];
  
  function shouldShowForm(message) {
    return FORM_TRIGGERS.some(regex => regex.test(message));
  }
  
  function isDirectFormRequest(message) {
    return DIRECT_FORM_REQUESTS.some(regex => regex.test(message));
  }

  
  function maybeOfferPhoneFlow(botReply){
    const history = loadHistory();
    const userMessages = history.filter(m => m.role === 'user').length;
    const botMessages = history.filter(m => m.role === 'assistant').length;
    
    // Бот должен ответить хотя бы на один вопрос клиента перед предложением формы
    if (botMessages < 1) {
      return; // Не предлагаем форму пока бот не ответил на вопросы
    }
    
    // Проверяем паузу между показами форм (минимум 3 реплики клиента)
    console.log('maybeOfferPhoneFlow pause check:', { lastFormShownAt, userMessagesAfterLastForm, bypassFormPause });
    
    // Обходим паузу для прямых просьб заполнить форму
    const isDirectRequest = isDirectFormRequest(botReply);
    console.log('Direct request check:', { botReply, isDirectRequest, bypassFormPause, lastFormShownAt, userMessagesAfterLastForm });
    if (!bypassFormPause && !isDirectRequest && lastFormShownAt > 0 && userMessagesAfterLastForm < 3) {
      console.log('maybeOfferPhoneFlow paused - not showing form');
      return; // Не показываем форму слишком часто
    }
    
    // Специальная проверка на запрос записи в шоурум
    const showroomKeywords = ['шоурум', 'шоу-рум', 'шоуруме', 'записаться в шоурум', 'запись в шоурум', 'посмотреть в шоуруме', 'приехать в шоурум'];
    const hasShowroomRequest = showroomKeywords.some(keyword => botReply.toLowerCase().includes(keyword));
    
    if (hasShowroomRequest) {
      // Показываем форму записи в шоурум
      addMsg('bot', 'Подскажите пожалуйста в каком городе находитесь и ваш номер телефона, передам дизайнеру в шоу-руме и он с вами свяжется');
      setTimeout(() => {
        renderShowroomForm();
      }, 1000);
      return;
    }
    
    // Use shared form triggers
    
    const matchedTriggers = FORM_TRIGGERS.filter(regex => regex.test(botReply));
    
    const forceFormWords = ['закреплю', 'спецпредложение', 'скидка', '10%', 'специальная', 'подарок', 'выберите', 'выбор', 'диван', 'цена', 'стоимость', 'подходит', 'нравится', 'интересно'];
    const hasForceWords = forceFormWords.some(word => botReply.toLowerCase().includes(word));
    
    // Проверяем специальные триггеры
    const installmentKeywords = ['рассрочк', 'рассрочку', 'рассрочка', 'рассрочки'];
    const customizationKeywords = ['размер', 'размеры', 'конструкц', 'кастомизац', 'измен', 'под заказ'];
    
    const hasInstallmentRequest = installmentKeywords.some(keyword => botReply.toLowerCase().includes(keyword));
    const hasCustomizationRequest = customizationKeywords.some(keyword => botReply.toLowerCase().includes(keyword));
    
    if (isDirectRequest || matchedTriggers.length > 0 || hasForceWords){
      
      if (hasInstallmentRequest) {
        // Показываем форму для рассрочки
        renderConsultationForm();
      } else if (hasCustomizationRequest) {
        // Показываем форму для кастомизации
        renderForm('Согласование размеров и конструкции', [
          { id: 'name', placeholder: 'Имя', required: true },
          { id: 'phone', placeholder: 'Телефон (+375...)', required: true }
        ], 'Получить консультацию', 'Согласование размеров и конструкции');
      } else {
        // Обычная форма с подарками
        const pretexts = [
          'Закрепить подарок и оставить данные?',
          'Выберите подарок и оставьте контакты?',
          'Записать данные для получения подарка?',
          'Сохранить контакты для акции?'
        ];
        const randomPretext = pretexts[Math.floor(Math.random() * pretexts.length)];
        renderForm(randomPretext, [
          { type: 'offer' },
          { id: 'name', placeholder: 'Имя', required: true },
          { id: 'phone', placeholder: 'Телефон (+375...)', required: true }
        ], 'Получить подарок');
      }
      
    }
  }

  function renderForm(title, fields, submitText, pretext) {
    console.log('renderForm called:', { title, lastFormShownAt, userMessagesAfterLastForm, bypassFormPause });
    
    // Обновляем состояние отслеживания показа формы
    lastFormShownAt = Date.now();
    userMessagesAfterLastForm = 0;
    bypassFormPause = false; // Сбрасываем флаг обхода паузы после показа формы
    console.log('Form shown - reset counters:', { lastFormShownAt, userMessagesAfterLastForm, bypassFormPause });
    
    const wrap = document.createElement('div'); 
    wrap.className='vfw-msg bot';
    
    
    const fieldsHtml = fields.map(field => {
      if (field.type === 'offer') {
        return `
          <div style="margin-bottom:12px;font-size:14px;color:#666">Выберите подарок:</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
            <button class="offer-btn" data-offer="Журнальный стол" style="padding:12px 16px;border:2px solid #e0e0e0;border-radius:12px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;min-height:44px;font-size:16px">
              <div style="font-weight:600;color:#333">🎁 Журнальный стол</div>
              <div style="font-size:12px;color:#666">При заказе дивана от 1500 BYN</div>
            </button>
            <button class="offer-btn" data-offer="Кухонный стол" style="padding:12px 16px;border:2px solid #e0e0e0;border-radius:12px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;min-height:44px;font-size:16px">
              <div style="font-weight:600;color:#333">🍽️ Кухонный стол</div>
              <div style="font-size:12px;color:#666">При заказе кухни от 1500 BYN</div>
            </button>
          </div>
        `;
      }
      return `<input id="${field.id}" placeholder="${field.placeholder}" style="padding:12px 16px;border:1px solid rgba(17,17,17,.12);border-radius:10px;font-size:16px;height:44px;box-sizing:border-box">`;
    }).join('');
    
    wrap.innerHTML = `
      <div class="vfw-avatar"><img src="./images/consultant.jpg" alt="bot"></div>
      <div class="bubble">
        <div style="font-weight:600;margin-bottom:6px">${title}</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          ${fieldsHtml}
          <button class="form-submit" style="padding:12px 16px;border-radius:10px;background:${CONFIG.brand.accent};color:#fff;border:0;min-height:44px;font-size:16px">${submitText}</button>
        </div>
        <div class="vfw-disc">Нажимая "${submitText}", вы соглашаетесь на обработку персональных данных.</div>
      </div>
    `;
    
    els.body.appendChild(wrap);
    
    setTimeout(() => {
      const isAtBottom = els.body.scrollTop + els.body.clientHeight >= els.body.scrollHeight - 10;
      if (isAtBottom) {
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
    
    let selectedOffer = null;
    const offerButtons = wrap.querySelectorAll('.offer-btn');
    
    offerButtons.forEach(btn => {
      btn.addEventListener('click', ()=>{
        offerButtons.forEach(b => {
          b.style.borderColor = '#e0e0e0';
          b.style.backgroundColor = '#fff';
        });
        btn.style.borderColor = CONFIG.brand.accent;
        btn.style.backgroundColor = CONFIG.brand.accent + '10';
        selectedOffer = btn.dataset.offer;
      });
    });
    
    wrap.querySelector('.form-submit').addEventListener('click', async ()=>{
      const sendBtn = wrap.querySelector('.form-submit');
      const formData = {};
      
      fields.forEach(field => {
        if (field.type !== 'offer') {
          formData[field.id] = wrap.querySelector(`#${field.id}`).value.trim();
        }
      });
      
      if (selectedOffer) formData.offer = selectedOffer;
      
      const validation = validateForm(formData, fields);
      if (validation.error) {
        addMsg('bot', validation.error);
        return;
      }
      
      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.6';
      sendBtn.style.cursor = 'not-allowed';
      sendBtn.textContent = 'Отправляем...';
      
      try {
        await submitLead(formData.name || 'Пользователь', formData.phone, pretext || formData.offer);
        wrap.remove();
      } finally {
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        sendBtn.style.cursor = 'pointer';
        sendBtn.textContent = submitText;
      }
    });
  }
  
  function validateForm(data, fields) {
    for (const field of fields) {
      if (field.required && !data[field.id]) {
        return { error: `Пожалуйста, укажите ${field.placeholder.toLowerCase()}.` };
      }
    }
    if (data.phone && !normalizePhone(data.phone)) {
      return { error: 'Пожалуйста, введите корректный номер телефона (например, +375XXXXXXXXX).' };
    }
    return { valid: true };
  }

  function renderShowroomForm(){
    renderForm(
      'Запись в шоурум',
      [
        { id: 'city', placeholder: 'Город', required: true },
        { id: 'phone', placeholder: 'Телефон (+375...)', required: true }
      ],
      'Записаться в шоурум',
      'Запись в шоурум'
    );
  }

  function renderConsultationForm(){
    renderForm(
      'Консультация по рассрочке',
      [
        { id: 'name', placeholder: 'Имя', required: true },
        { id: 'phone', placeholder: 'Телефон (+375...)', required: true }
      ],
      'Получить консультацию',
      'Консультация по рассрочке'
    );
  }

  function renderFallbackForm(){
    renderForm(
      'Извините, система временно недоступна. Оставьте телефон и наш специалист перезвонит вам.',
      [
        { id: 'name', placeholder: 'Имя', required: true },
        { id: 'phone', placeholder: 'Телефон (+375...)', required: true }
      ],
      'Связаться со мной',
      'Техническая проблема - запрос на обратный звонок'
    );
  }

  async function submitLead(name, phone, pretext){
    // Check if offline
    if (!navigator.onLine) {
      addMsg('bot','Похоже, нет подключения к интернету. Попробуйте позже.');
      return;
    }

    const leadKey = `${phone}_${pretext}`;
    if (submittedLeads.has(leadKey)) {
      addMsg('bot','Данные уже отправлены. Дизайнер свяжется с вами.');
      return;
    }
    
    const page_url = location.href;
    try{
      // Use retry logic for lead submission too
      await fetchWithRetry('./api/lead', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          gas_url: CONFIG.gasEndpoint,
          timestamp: nowIso(),
          name,
          phone,
          pretext,
          page_url,
          session_id: SESSION_ID
        })
      }, 2); // 2 попытки для отправки лида
      submittedLeads.add(leadKey);
      
      // Разные сообщения в зависимости от типа запроса
      if (pretext.includes('Консультация дизайнера')) {
        addMsg('bot','Спасибо! Дизайнер свяжется с вами в рабочее время в течение 2 часов для консультации.');
      } else if (pretext.includes('Запись в шоурум')) {
        addMsg('bot','Спасибо! Записал ваши данные. Дизайнер свяжется с вами в течение пары часов в рабочее время.');
      } else {
        addMsg('bot','Спасибо! Передам вашу заявку дизайнеру, он свяжется с вами для закрепления подарка.');
      }
    }catch(e){
      let errorMessage;
      if (e.message === 'Request timeout') {
        errorMessage = 'Запрос выполняется слишком долго. Проверьте подключение к интернету.';
      } else if (!navigator.onLine) {
        errorMessage = 'Похоже, нет подключения к интернету. Попробуйте позже.';
      } else {
        errorMessage = 'Не удалось записать номер. Попробуйте ещё раз или укажите позже.';
      }
      addMsg('bot', errorMessage);
    }
  }

  // Check widget version without forcing reloads
  function checkWidgetVersion() {
    const storedVersion = localStorage.getItem('vfw_widget_version');
    
    if (storedVersion !== WIDGET_VERSION) {
      localStorage.removeItem('vfw_widget_version');
    }
    localStorage.setItem('vfw_widget_version', WIDGET_VERSION);
  }


  // Опциональная предзагрузка каталога в 18:00 Минск
  function schedulePreload() {
    const now = new Date();
    const minsk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Minsk' }));
    const target = new Date(minsk);
    target.setHours(18, 0, 0, 0);
    
    if (minsk > target) {
      target.setDate(target.getDate() + 1); // Завтра в 18:00
    }
    
    const delay = target - minsk;
    setTimeout(() => {
      console.log('Preloading catalog at 18:00 Minsk time');
      fetchPromptAndCatalog().catch(e => {
        console.warn('Failed to preload catalog:', e);
      });
      // Повторять каждый день
      setInterval(() => {
        fetchPromptAndCatalog().catch(e => {
          console.warn('Failed to preload catalog:', e);
        });
      }, 24 * 60 * 60 * 1000);
    }, delay);
  }

  // Инициализация
  (async function init(){
    checkWidgetVersion();
    
    // Подключаем триггеры СРАЗУ
    schedulePageCountTrigger();
    watchSpaRouting();
    setupExitIntent();
    
    // Показываем приветственную подсказку через 15 секунд
    setTimeout(() => {
      if (els.panel.getAttribute('data-open') !== '1' && canShowHints()) {
        showHintsWithAutoHide('Привет! ✋\nЯ онлайн и готов помочь с выбором мебели!');
      }
    }, 15000);
    
    // Загружаем данные в фоне
    fetchPromptAndCatalog().catch(e => {
      console.warn('Failed to load prompt/catalog:', e);
    });
    
    // Настраиваем предзагрузку в 18:00 Минск
    schedulePreload();
  })();
})();
