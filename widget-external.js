(function(){
  // Widget version - increment this when making changes
  const WIDGET_VERSION = '5.1.0';
  
  if (window.VFW_LOADED) {
    return;
  }
  window.VFW_LOADED = true;
  
  const CONFIG = {
    openaiEndpoint: null, // Will be set from dataset or default
    leadEndpoint: null, // Will be set from dataset or default
    promptUrl: null, // Will be set from dataset or default
    triggerMinIntervalMs: 60_000,
    pageThreshold: 2,
    brand: { accent: '#6C5CE7', bg: '#ffffff', text: '#111', radius: 16 },
    avatarUrl: null,
    avatarInitials: 'NM',
    bottomOffset: null,
    rightOffset: null
  };
  const DEBUG = Boolean(window.VFW_DEBUG);

  // Get widget base URL from script src for absolute paths
  function getWidgetBaseUrl() {
    try {
      const current = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      if (current && current.src) {
        const url = new URL(current.src);
        return url.origin + url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
      }
    } catch(e) {
      if (DEBUG) console.warn('Failed to get widget base URL:', e);
    }
    // Fallback to current origin if script src not available
    return window.location.origin + '/';
  }
  
  const WIDGET_BASE_URL = getWidgetBaseUrl();
  function parsePixelValue(val){
    if (val === undefined || val === null) return null;
    if (typeof val === 'number') return `${val}px`;
    const trimmed = `${val}`.trim();
    if (!trimmed) return null;
    if (/px|%|vh|vw|rem|em/.test(trimmed)) return trimmed;
    const num = Number(trimmed);
    return Number.isFinite(num) ? `${num}px` : null;
  }
  const DEFAULT_AVATAR_URL = (WIDGET_BASE_URL || 'https://widget-nine-murex.vercel.app/') + 'images/consultant.jpg';

  // Read configuration from script dataset
  (function(){
    try{
      const current = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      if (!current) return;
      let promptUrl = current.dataset.prompt || CONFIG.promptUrl;
      // Convert relative URLs to absolute
      if (promptUrl && promptUrl.startsWith('./')) {
        promptUrl = WIDGET_BASE_URL + promptUrl.substring(2);
      } else if (promptUrl && !promptUrl.startsWith('http')) {
        promptUrl = WIDGET_BASE_URL + promptUrl;
      }
      CONFIG.promptUrl = promptUrl;
      if (current.dataset.api) {
        let apiUrl = current.dataset.api;
        // Convert relative URLs to absolute
        if (apiUrl.startsWith('./')) {
          apiUrl = WIDGET_BASE_URL + apiUrl.substring(2);
        } else if (!apiUrl.startsWith('http')) {
          apiUrl = WIDGET_BASE_URL + apiUrl;
        }
        CONFIG.openaiEndpoint = apiUrl;
      } else {
        // Default to absolute path
        CONFIG.openaiEndpoint = WIDGET_BASE_URL + 'api/chat';
      }
      
      if (current.dataset.lead) {
        let leadUrl = current.dataset.lead;
        if (leadUrl.startsWith('./')) {
          leadUrl = WIDGET_BASE_URL + leadUrl.substring(2);
        } else if (!leadUrl.startsWith('http')) {
          leadUrl = WIDGET_BASE_URL + leadUrl;
        }
        CONFIG.leadEndpoint = leadUrl;
      } else {
        CONFIG.leadEndpoint = WIDGET_BASE_URL + 'api/lead';
      }
      if (current.dataset.avatar) {
        let avatarUrl = current.dataset.avatar;
        if (avatarUrl.startsWith('./')) {
          avatarUrl = WIDGET_BASE_URL + avatarUrl.substring(2);
        } else if (!avatarUrl.startsWith('http')) {
          avatarUrl = WIDGET_BASE_URL + avatarUrl;
        }
        CONFIG.avatarUrl = avatarUrl;
      } else {
        CONFIG.avatarUrl = DEFAULT_AVATAR_URL;
      }
      CONFIG.avatarInitials = (current.dataset.avatarInitials || CONFIG.avatarInitials || 'NM')
        .toString()
        .slice(0, 3)
        .toUpperCase();
      CONFIG.bottomOffset = parsePixelValue(current.dataset.bottomOffset) || CONFIG.bottomOffset;
      CONFIG.rightOffset = parsePixelValue(current.dataset.rightOffset) || CONFIG.rightOffset;
      
      if (current.dataset.promptContent) CONFIG.promptContent = current.dataset.promptContent;
      
      // Set default promptUrl if not provided
      if (!CONFIG.promptUrl) {
        CONFIG.promptUrl = WIDGET_BASE_URL + 'prompt.json';
      }
      
      if (CONFIG.promptUrl && !CONFIG.promptUrl.includes('v=')) CONFIG.promptUrl += '?v=' + WIDGET_VERSION;
    }catch(e){}
  })();
  
  if (!CONFIG.avatarUrl) {
    CONFIG.avatarUrl = DEFAULT_AVATAR_URL;
  }

  // FIXED: Generate unique session_id including origin to prevent conflicts between different sites
  function getOrSetSessionId(){
    const key='vf_session_id_external';
    // Include origin in session ID to make it unique per site
    const originHash = btoa(location.origin).replace(/[+/=]/g, '').substring(0, 8);
    const originKey = `${key}_${originHash}`;
    
    const m=document.cookie.match(new RegExp(`(?:^|; )${originKey}=([^;]+)`));
    if (m) return m[1];
    
    // Create unique ID: origin hash + timestamp + random
    const id = `s_${originHash}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    document.cookie=`${originKey}=${id}; path=/; max-age=${60*60*24*365}`;
    return id;
  }
  const SESSION_ID = getOrSetSessionId();

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
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
    /* CSS Reset для изоляции виджета от стилей сайта-хозяина */
    .vfw-root, .vfw-root * {
      box-sizing: border-box !important;
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
    }
    
    /* Основные стили виджета с изоляцией */
    .vfw-root {
      all: initial;
      position: fixed !important;
      right: var(--vfw-right-offset, 60px) !important;
      bottom: var(--vfw-bottom-offset, 60px) !important;
      z-index: 999999 !important;
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
      display: block !important;
    }
    
    .vfw-btn {
      width: 84px !important;
      height: 84px !important;
      border-radius: 50% !important;
      background: ${CONFIG.brand.text} !important;
      color: #fff !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 6px 24px rgba(0,0,0,.16) !important;
      cursor: pointer !important;
      transition: transform .12s ease !important;
      border: none !important;
      touch-action: manipulation !important;
      margin: 0 !important;
      padding: 0 !important;
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
    
    /* Основная панель виджета с изоляцией */
    .vfw-panel {
      position: fixed !important;
      right: 20px !important;
      bottom: 20px !important;
      width: clamp(344px, 26.5rem, min(424px, calc(100vw - 40px))) !important;
      max-width: min(584px, calc(100vw - 40px)) !important;
      min-width: 344px !important;
      height: 90vh !important;
      max-height: 90vh !important;
      background: #fff !important;
      border-radius: ${CONFIG.brand.radius}px !important;
      box-shadow: 0 24px 64px rgba(0,0,0,.20) !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      border: 1px solid rgba(17,17,17,.06) !important;
      z-index: 999999 !important;
      box-sizing: border-box !important;
      transform: translateY(100%) !important;
      opacity: 0 !important;
      transition: all 0.3s ease !important;
      visibility: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    
    .vfw-panel[data-open="1"] {
      transform: translateY(0) !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    
    /* Мобильные стили */
    @media (max-width: 768px) {
      .vfw-root {
        right: var(--vfw-right-offset-mobile, 20px) !important;
        bottom: var(--vfw-bottom-offset-mobile, 20px) !important;
      }
      
      .vfw-btn {
        width: 96px;
        height: 96px;
        box-shadow: 0 8px 32px rgba(0,0,0,.25);
      }
      
      .vfw-avatar-lg {
        width: 96px !important;
        height: 96px !important;
        min-width: 96px !important;
        min-height: 96px !important;
        max-width: 96px !important;
        max-height: 96px !important;
        border-radius: 50% !important;
        overflow: hidden !important;
        padding: 0 !important;
        margin: 0 !important;
        box-sizing: border-box !important;
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
        width: 100%;
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
        right: var(--vfw-right-offset-mobile, 16px) !important;
        bottom: var(--vfw-bottom-offset-mobile, 16px) !important;
      }
      
      .vfw-btn {
        width: 88px;
        height: 88px;
      }
      
      .vfw-avatar-lg {
        width: 88px !important;
        height: 88px !important;
        min-width: 88px !important;
        min-height: 88px !important;
        max-width: 88px !important;
        max-height: 88px !important;
        border-radius: 50% !important;
        overflow: hidden !important;
        padding: 0 !important;
        margin: 0 !important;
        box-sizing: border-box !important;
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
    
    .vfw-msg .vfw-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      overflow: hidden;
      margin-right: 8px;
      flex: 0 0 28px;
      border: 1px solid rgba(17,17,17,.08);
    }
    
    .vfw-msg .vfw-avatar img {
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
      position: fixed !important;
      right: var(--vfw-hint-right, 60px) !important;
      bottom: var(--vfw-hint-bottom, 160px) !important;
      display: none;
      flex-direction: column;
      gap: 20px;
      z-index: 999998 !important;
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

    .vfw-avatar {
      position: relative !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 50% !important;
      overflow: hidden !important;
      background: #f4f4f4 !important;
    }
    
    .vfw-avatar-lg {
      width: 84px !important;
      height: 84px !important;
      min-width: 84px !important;
      min-height: 84px !important;
      max-width: 84px !important;
      max-height: 84px !important;
      border: none !important;
      border-radius: 50% !important;
      overflow: hidden !important;
      position: relative !important;
      display: block !important;
      padding: 0 !important;
      margin: 0 !important;
      box-sizing: border-box !important;
      flex-shrink: 0 !important;
    }
    
    .vfw-avatar-sm {
      width: 28px !important;
      height: 28px !important;
      border: 1px solid rgba(17,17,17,.1) !important;
    }
    
    .vfw-avatar-img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      display: block !important;
    }
    
    .vfw-avatar-lg .vfw-avatar-img,
    #vfwBtnAvatar .vfw-avatar-img,
    .vfw-btn .vfw-avatar-lg .vfw-avatar-img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      object-position: center center !important;
      border-radius: 50% !important;
      min-width: 100% !important;
      min-height: 100% !important;
      max-width: 100% !important;
      max-height: 100% !important;
      display: block !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
    }
    
    .vfw-avatar-fallback {
      position: absolute !important;
      inset: 0 !important;
      display: none !important;
      align-items: center !important;
      justify-content: center !important;
      font-weight: 600 !important;
      color: #fff !important;
      background: ${CONFIG.brand.accent} !important;
    }
    
    .vfw-avatar.has-fallback .vfw-avatar-fallback {
      display: flex !important;
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
      <span class="vfw-avatar vfw-avatar-lg" id="vfwBtnAvatar">
        <img class="vfw-avatar-img" alt="Консультант">
        <span class="vfw-avatar-fallback" aria-hidden="true">NM</span>
      </span>
      <span class="vfw-online-indicator"></span>
    </button>
    <div class="vfw-hints" id="vfwHints">
      <div class="vfw-hint" id="vfwHintSingle">
        <button class="vfw-hint-close" id="vfwHintClose" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <div class="vfw-hint-content">
          Привет! 👋<br>Хотите подборку мебели для вашего интерьера со скидкой или подарком на выбор прямо в мессенджер?
        </div>
      </div>
    </div>
    <div class="vfw-panel" id="vfwPanel" role="dialog" aria-modal="true">
      <div class="vfw-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="vfw-avatar vfw-avatar-sm">
            <img class="vfw-avatar-img" alt="Аватар">
            <span class="vfw-avatar-fallback" aria-hidden="true">NM</span>
          </span>
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
  
  if (CONFIG.bottomOffset) {
    root.style.setProperty('--vfw-bottom-offset', CONFIG.bottomOffset);
    root.style.setProperty('--vfw-bottom-offset-mobile', CONFIG.bottomOffset);
  }
  if (CONFIG.rightOffset) {
    root.style.setProperty('--vfw-right-offset', CONFIG.rightOffset);
    root.style.setProperty('--vfw-right-offset-mobile', CONFIG.rightOffset);
  }
  
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
  
  // Обработка клавиатуры для мобильных устройств
  function handleKeyboardResize() {
    const panel = document.querySelector('.vfw-panel');
    if (!panel) return;
    
    if (!isMobile()) return;
    
    const input = document.getElementById('vfwInput');
    if (!input) return;
    
    // Используем разные подходы для iOS и Android
    if (isAndroid()) {
      // Для Android используем window.innerHeight и проверку видимости input
      const windowHeight = window.innerHeight;
      const inputRect = input.getBoundingClientRect();
      const inputVisible = inputRect.bottom < windowHeight && inputRect.top > 0;
      
      // Если input не виден (скрыт клавиатурой), скроллим его в видимую область
      if (!inputVisible && inputRect.bottom > windowHeight) {
        const body = document.getElementById('vfwBody');
        if (body) {
          // Прокручиваем контейнер чата к концу
          body.scrollTop = body.scrollHeight;
          
          // Для Android используем scrollIntoView с 'end' вместо 'center' чтобы не было лишнего отступа
          setTimeout(() => {
            input.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'end',
              inline: 'nearest'
            });
          }, 100);
        }
      }
    } else {
      // Для iOS используем visualViewport (работает стабильно)
      const vh = window.visualViewport?.height || window.innerHeight;
      const windowHeight = window.innerHeight;
      
      const keyboardOpen = vh < windowHeight * 0.75;
      
      if (keyboardOpen) {
        const availableHeight = Math.max(vh * 0.9, 400);
        panel.style.height = availableHeight + 'px';
        panel.style.maxHeight = availableHeight + 'px';
        
        // Убираем лишние трансформации - используем только изменение высоты панели
        // Это обеспечит правильное позиционирование без лишних отступов
      } else {
        panel.style.height = '';
        panel.style.maxHeight = '';
        panel.style.transform = '';
      }
    }
  }
  
  // Слушаем изменения размера для iOS
  window.visualViewport?.addEventListener('resize', handleKeyboardResize);
  
  // Для Android также слушаем изменения window.innerHeight
  if (isAndroid()) {
    let lastHeight = window.innerHeight;
    const androidKeyboardCheck = () => {
      const currentHeight = window.innerHeight;
      // Если высота изменилась значительно (более 150px), вероятно открылась клавиатура
      if (Math.abs(currentHeight - lastHeight) > 150) {
        handleKeyboardResize();
      }
      lastHeight = currentHeight;
    };
    
    window.addEventListener('resize', androidKeyboardCheck);
    // Также проверяем при изменении ориентации
    window.addEventListener('orientationchange', () => {
      setTimeout(androidKeyboardCheck, 300);
    });
  }
  
  const input = document.getElementById('vfwInput');
  input.addEventListener('focus', () => {
    // Разная задержка для iOS и Android
    const delay = isAndroid() ? 500 : 300;
    
    setTimeout(() => {
      const body = document.getElementById('vfwBody');
      if (body) {
        // Прокручиваем к концу чата
        body.scrollTo({
          top: body.scrollHeight,
          behavior: 'smooth'
        });
      }
      
      // Для Android используем scrollIntoView для input
      if (isAndroid()) {
        setTimeout(() => {
          input.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'end',
            inline: 'nearest'
          });
          // Дополнительная проверка после скролла
          setTimeout(handleKeyboardResize, 200);
        }, 100);
      } else {
        // Для iOS используем visualViewport логику
        // Панель автоматически подстроится через handleKeyboardResize
        // Не нужно дополнительно менять высоту здесь
      }
    }, delay);
  });
  
  // Дополнительная обработка для Android при blur (закрытие клавиатуры)
  if (isAndroid()) {
    input.addEventListener('blur', () => {
      setTimeout(() => {
        const panel = document.querySelector('.vfw-panel');
        if (panel) {
          panel.style.transform = '';
        }
      }, 300);
    });
  }
  
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

  initAvatarImages();
  updateHintPosition();
  window.addEventListener('resize', handleWidgetResize, { passive: true });

  function initAvatarImages(){
    const containers = root.querySelectorAll('.vfw-avatar');
    containers.forEach(container => {
      applyAvatarToContainer(container);
    });
  }

  function applyAvatarToContainer(container){
    const img = container.querySelector('.vfw-avatar-img');
    const fallbackEl = container.querySelector('.vfw-avatar-fallback');
    const initials = (CONFIG.avatarInitials || 'NM').toString().slice(0, 3).toUpperCase();
    if (fallbackEl) fallbackEl.textContent = initials;

    const showFallback = () => {
      container.classList.add('has-fallback');
      if (fallbackEl) fallbackEl.textContent = initials;
    };

    if (!img) {
      showFallback();
      return;
    }

    img.addEventListener('error', showFallback, { once: true });
    img.addEventListener('load', () => container.classList.remove('has-fallback'));

    const avatarSrc = CONFIG.avatarUrl || DEFAULT_AVATAR_URL;
    if (avatarSrc) {
      img.src = avatarSrc;
    } else {
      showFallback();
    }
  }

  let resizeRaf = null;
  function handleWidgetResize(){
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(updateHintPosition);
  }

  function updateHintPosition(){
    if (!els.btn || !els.hints) return;
    const rect = els.btn.getBoundingClientRect();
    const rightOffset = Math.max(16, window.innerWidth - rect.right + 16);
    const bottomOffset = Math.max(16, window.innerHeight - rect.top + 20);
    els.hints.style.setProperty('--vfw-hint-right', `${rightOffset}px`);
    els.hints.style.setProperty('--vfw-hint-bottom', `${bottomOffset}px`);
  }

  initAvatarImages();
  updateHintPosition();
  window.addEventListener('resize', handleWidgetResize, { passive: true });

  // Функция для трекинга аналитических событий
  let pageViewTracked = false;
  function trackEvent(eventType) {
    // Отправляем событие асинхронно, не блокируя UI
    const analyticsUrl = CONFIG.openaiEndpoint ? CONFIG.openaiEndpoint.replace('/chat', '/analytics') : WIDGET_BASE_URL + 'api/analytics';
    fetch(analyticsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: eventType,
        session_id: SESSION_ID
      })
    }).catch(err => {
      // Игнорируем ошибки аналитики, чтобы не блокировать виджет
      if (DEBUG) console.warn('Analytics tracking failed:', err);
    });
  }

  function openPanel(){
    els.panel.setAttribute('data-open','1');
    disableScroll();
    // Трекинг открытия виджета (только один раз за сессию)
    if (!els.panel.hasAttribute('data-widget-opened')) {
      trackEvent('widget_open');
      els.panel.setAttribute('data-widget-opened', '1');
    }
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
      row.innerHTML = `<div class="vfw-msg bot"><div class="vfw-avatar"><img src="${WIDGET_BASE_URL}images/consultant.jpg" alt="bot"></div><div class="bubble"></div></div>`;
    } else {
      const initials = (CONFIG.avatarInitials || 'NM').toString().slice(0, 3).toUpperCase();
      row.innerHTML = `<div class="vfw-msg user"><div class="bubble"></div><div class="vfw-avatar"><img class="vfw-avatar-img" alt="Пользователь"><span class="vfw-avatar-fallback" aria-hidden="true">${initials}</span></div></div>`;
    }
    
    const safeText = escapeHtml(text);
    row.querySelector('.bubble').innerHTML = safeText;
    els.body.appendChild(row);
    
    // Применяем правильную загрузку аватара для сообщений пользователя
    if (role === 'user') {
      const avatarContainer = row.querySelector('.vfw-avatar');
      if (avatarContainer) {
        applyAvatarToContainer(avatarContainer);
      }
    }
    
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

  
  function showTyping(){
    const typingRow = document.createElement('div');
    typingRow.className = 'vfw-typing';
    typingRow.innerHTML = `
      <div class="vfw-avatar"><img src="${WIDGET_BASE_URL}images/consultant.jpg" alt="bot"></div>
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

  let PROMPT = null;
  const submittedLeads = new Set();
  let fallbackFormShown = false; // Флаг для отслеживания показа fallback формы
  let widgetOpenedInSession = false; // Флаг для отслеживания первого открытия виджета в сессии
  let lastFormShownAt = 0; // Время последнего показа формы
  let userMessagesAfterLastForm = 0; // Количество сообщений пользователя после последней формы
  let bypassFormPause = false; // Флаг обхода паузы для форм от кнопок быстрых действий

  // Словарь подарков по категориям
  const GIFTS_BY_CATEGORY = {
    'Диван': [
      { text: '🎁 Журнальный стол в подарок', value: 'Журнальный стол в подарок' },
      { text: '💰 Скидка 5%', value: 'Скидка 5%' }
    ],
    'Кровать': [
      { text: '🎁 Подъемный механизм в подарок', value: 'Купи кровать, подъемный механизм в подарок' },
      { text: '🛏️ Матрас за полцены', value: 'Купи кровать, матрас за полцены' },
      { text: '💰 Скидка 5%', value: 'Скидка 5%' }
    ],
    'Кухня': [
      { text: '🎁 Кухонный стол в подарок', value: 'Кухонный стол в подарок' },
      { text: '💰 Скидка 5%', value: 'Скидка 5%' }
    ],
    'Другое': [
      { text: '💰 Скидка 5%', value: 'Скидка 5%' }
    ]
  };

  // Показать кнопки выбора категории
  function showCategoryButtons() {
    const buttons = [
      { text: '🛋️ Диван', category: 'Диван' },
      { text: '🛏️ Кровать', category: 'Кровать' },
      { text: '🍽️ Кухня', category: 'Кухня' },
      { text: '📦 Другое', category: 'Другое' }
    ];
    
    // Create container for horizontal layout
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 8px 36px;justify-content:flex-start';
    
    buttons.forEach(buttonData => {
      const button = document.createElement('button');
      button.className = 'category-btn';
      button.dataset.category = buttonData.category;
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
      button.innerHTML = buttonData.text;
      
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
        container.remove(); // Remove all category buttons
        showGiftForm(buttonData.category);
      });
      
      container.appendChild(button);
    });
    
    els.body.appendChild(container);
    
    // Smart scrolling for category buttons
    setTimeout(() => {
      const isAtBottom = els.body.scrollTop + els.body.clientHeight >= els.body.scrollHeight - 10;
      if (isAtBottom) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }
  
  // Функция склонения категорий для заголовка
  function getCategoryGenitive(category) {
    const genitive = {
      'Диван': 'дивана',
      'Кровать': 'кровати',
      'Кухня': 'кухни',
      'Другое': 'другой мебели'
    };
    return genitive[category] || 'товара';
  }

  // Показать форму с подарками для выбранной категории
  function showGiftForm(category) {
    const gifts = GIFTS_BY_CATEGORY[category] || [];
    
    const wrap = document.createElement('div'); 
    wrap.className='vfw-msg bot';
    
    const giftsHtml = gifts.map(gift => `
      <button class="gift-btn" data-gift="${gift.value}" style="padding:12px 16px;border:2px solid #e0e0e0;border-radius:12px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;min-height:44px;font-size:16px;width:100%;margin-bottom:8px">
        ${gift.text}
      </button>
    `).join('');
    
    wrap.innerHTML = `
      <div class="vfw-avatar"><img src="${WIDGET_BASE_URL}images/consultant.jpg" alt="bot"></div>
      <div class="bubble">
        <div style="font-weight:600;margin-bottom:6px">Выберите подарок и оставьте контакты</div>
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">
          <div style="margin-bottom:12px;font-size:14px;color:#666">Выберите подарок при заказе ${getCategoryGenitive(category)}:</div>
          ${giftsHtml}
          <div style="margin-top:16px;margin-bottom:12px;font-size:14px;color:#666">Выберите удобный мессенджер:</div>
          <div style="display:flex;gap:8px;margin-bottom:16px">
            <button class="messenger-btn" data-messenger="WhatsApp" style="flex:1;padding:12px;border:2px solid #e0e0e0;border-radius:12px;background:#fff;cursor:pointer;text-align:center;transition:all 0.2s;min-height:44px;font-size:14px">
              WhatsApp
            </button>
            <button class="messenger-btn" data-messenger="Telegram" style="flex:1;padding:12px;border:2px solid #e0e0e0;border-radius:12px;background:#fff;cursor:pointer;text-align:center;transition:all 0.2s;min-height:44px;font-size:14px">
              Telegram
            </button>
            <button class="messenger-btn" data-messenger="Viber" style="flex:1;padding:12px;border:2px solid #e0e0e0;border-radius:12px;background:#fff;cursor:pointer;text-align:center;transition:all 0.2s;min-height:44px;font-size:14px">
              Viber
            </button>
        </div>
          <input id="vfwName" placeholder="Имя" style="padding:12px 16px;border:1px solid rgba(17,17,17,.12);border-radius:10px;font-size:16px;height:44px;box-sizing:border-box;margin-bottom:4px">
          <input id="vfwPhone" placeholder="Телефон (+375...)" style="padding:12px 16px;border:1px solid rgba(17,17,17,.12);border-radius:10px;font-size:16px;height:44px;box-sizing:border-box;margin-bottom:4px">
          <textarea id="vfwWishes" placeholder="Пожелания (необязательно)" style="padding:12px 16px;border:1px solid rgba(17,17,17,.12);border-radius:10px;font-size:16px;min-height:60px;box-sizing:border-box;margin-bottom:4px;resize:vertical;font-family:inherit"></textarea>
          <button class="gift-form-submit" style="padding:12px 16px;border-radius:10px;background:${CONFIG.brand.accent};color:#fff;border:0;min-height:44px;font-size:16px">Получить подарок</button>
        </div>
        <div class="vfw-disc">Нажимая "Получить подарок", вы соглашаетесь на обработку персональных данных.</div>
      </div>
    `;
    
    els.body.appendChild(wrap);
    
    setTimeout(() => {
      const isAtBottom = els.body.scrollTop + els.body.clientHeight >= els.body.scrollHeight - 10;
      if (isAtBottom) {
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
    
    let selectedGift = null;
    let selectedMessenger = null;
    
    // Gift selection
    const giftButtons = wrap.querySelectorAll('.gift-btn');
    giftButtons.forEach(btn => {
      btn.addEventListener('click', ()=>{
        giftButtons.forEach(b => {
          b.style.borderColor = '#e0e0e0';
          b.style.backgroundColor = '#fff';
        });
        btn.style.borderColor = CONFIG.brand.accent;
        btn.style.backgroundColor = CONFIG.brand.accent + '10';
        selectedGift = btn.dataset.gift;
      });
    });
    
    // Messenger selection
    const messengerButtons = wrap.querySelectorAll('.messenger-btn');
    messengerButtons.forEach(btn => {
      btn.addEventListener('click', ()=>{
        messengerButtons.forEach(b => {
          b.style.borderColor = '#e0e0e0';
          b.style.backgroundColor = '#fff';
        });
        btn.style.borderColor = CONFIG.brand.accent;
        btn.style.backgroundColor = CONFIG.brand.accent + '10';
        selectedMessenger = btn.dataset.messenger;
      });
    });
    
    // Form submission
    wrap.querySelector('.gift-form-submit').addEventListener('click', async ()=>{
      const sendBtn = wrap.querySelector('.gift-form-submit');
      const name = wrap.querySelector('#vfwName').value.trim();
      const phone = wrap.querySelector('#vfwPhone').value.trim();
      const wishes = wrap.querySelector('#vfwWishes').value.trim();
      
      if (!name) {
        addMsg('bot', 'Пожалуйста, укажите имя.');
        return;
      }
      
      if (!phone || !normalizePhone(phone)) {
        addMsg('bot', 'Пожалуйста, введите корректный номер телефона (например, +375XXXXXXXXX).');
        return;
      }
      
      if (!selectedGift) {
        addMsg('bot', 'Пожалуйста, выберите подарок.');
        return;
      }
      
      if (!selectedMessenger) {
        addMsg('bot', 'Пожалуйста, выберите мессенджер.');
        return;
      }
      
      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.6';
      sendBtn.style.cursor = 'not-allowed';
      sendBtn.textContent = 'Отправляем...';
      
      try {
        await submitGiftLead(name, phone, category, selectedGift, selectedMessenger, wishes);
        wrap.remove();
      } finally {
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        sendBtn.style.cursor = 'pointer';
        sendBtn.textContent = 'Получить подарок';
      }
    });
  }

  async function fetchPrompt(){
    // Use inline content if available, otherwise fetch from URLs
    let promptPromise;
    
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
    
    const [p] = await Promise.allSettled([promptPromise]);
    PROMPT = p.status==='fulfilled' ? p.value : null;
    
    // Initialize session on server with prompt only
    if (PROMPT && CONFIG.openaiEndpoint) {
      fetch(CONFIG.openaiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          session_id: SESSION_ID,
          prompt: PROMPT,
          locale: 'ru'
        })
      }).catch(e => {
        if (DEBUG) console.warn('Failed to initialize session:', e);
      });
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

  function setupScrollToBottomTrigger() {
    let scrollTimeout;
    
    function checkScrollToBottom() {
      // Проверяем, достаточно ли высока страница для скролла
      const pageHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      
      // Если страница слишком короткая, не показываем
      if (pageHeight <= viewportHeight * 1.2) {
        return;
      }
      
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      
      // Вычисляем процент прокрутки
      const scrollPercent = (scrollTop + clientHeight) / scrollHeight;
      
      // Если прокручено 95% или больше
      if (scrollPercent >= 0.95) {
        handleScrollToBottom();
      }
    }
    
    // Throttle для оптимизации производительности
    window.addEventListener('scroll', () => {
      if (scrollTimeout) {
        return;
      }
      
      scrollTimeout = setTimeout(() => {
        checkScrollToBottom();
        scrollTimeout = null;
      }, 100);
    }, { passive: true });
    
    // Проверяем при загрузке (на случай, если страница уже прокручена)
    setTimeout(checkScrollToBottom, 1000);
  }

  let lastTriggerAt = 0;
  function canTrigger(){ return Date.now() - lastTriggerAt > CONFIG.triggerMinIntervalMs; }
  function markTriggered(){ lastTriggerAt = Date.now(); }

  let hintsAutoHideTimer = null;
  let hintsCooldownTimer = null;
  let exitIntentTriggered = false;
  let scrollToBottomTriggered = false;
  
  function showHintsWithAutoHide(text) {
    
    if (hintsAutoHideTimer) { clearTimeout(hintsAutoHideTimer); hintsAutoHideTimer = null; }
    if (hintsCooldownTimer) { clearTimeout(hintsCooldownTimer); hintsCooldownTimer = null; }
    
    if (els.hintSingle) {
      const hintContent = els.hintSingle.querySelector('.vfw-hint-content');
      if (hintContent) {
        hintContent.innerHTML = text.replace(/\n/g, '<br>');
      }
    }
    
    updateHintPosition();
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
        hintContent.innerHTML = 'Перед тем как уйти — хочу предложить вам подарок на выбор 🎁';
      }
    }
    
    updateHintPosition();
    setTimeout(() => {
      els.hints.setAttribute('data-show','1');
    }, 100);
    
    hintsAutoHideTimer = setTimeout(() => {
      hideHints();
      startHintsCooldown();
    }, 20000);
  }
  
  function showScrollToBottomHints() {
    
    if (hintsAutoHideTimer) { clearTimeout(hintsAutoHideTimer); hintsAutoHideTimer = null; }
    if (hintsCooldownTimer) { clearTimeout(hintsCooldownTimer); hintsCooldownTimer = null; }
    
    if (els.hintSingle) {
      const hintContent = els.hintSingle.querySelector('.vfw-hint-content');
      if (hintContent) {
        hintContent.innerHTML = 'Нужна помощь с выбором? 👋<br>Вышлю подборку мебели прямо в мессенджер со скидкой или подарком на выбор!';
      }
    }
    
    updateHintPosition();
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
  
  function handleScrollToBottom() {
    if (els.panel.getAttribute('data-open') !== '1' && !scrollToBottomTriggered && canTrigger() && canShowHints()) {
      hideHints();
      showScrollToBottomHints();
      scrollToBottomTriggered = true;
      markTriggered();
    }
  }


  function schedulePageCountTrigger(){
    const n = incPageViews();
    if (n >= CONFIG.pageThreshold && canTrigger()){
      // Use IntersectionObserver for page count trigger too
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && els.panel.getAttribute('data-open') !== '1' && canShowHints()) {
            showHintsWithAutoHide('Вижу, вам интересна мебель! 💡\nПодберу варианты специально для вас со скидкой или подарком!');
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
      const reply = generateLocalReply(userText, PROMPT, null);
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
            if (DEBUG) console.log('Session not initialized, trying to reinitialize...');
            // Пробуем инициализировать сессию еще раз
            await fetchPrompt();
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
      
      return { 
        text, 
        formMessage: data.formMessage, 
        needsForm: data.needsForm,
        isProductQuestion: data.isProductQuestion,
        detectedCategory: data.detectedCategory
      };
      
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
    // Сбрасываем флаги триггеров при открытии панели
    exitIntentTriggered = false;
    scrollToBottomTriggered = false;
    
    // Показываем приветствие СРАЗУ без ожидания загрузки данных
    if (!widgetOpenedInSession) {
      widgetOpenedInSession = true;
      // Сбрасываем флаг fallback формы при начале новой сессии
      fallbackFormShown = false;
      
      // Показываем приветствие мгновенно
      addMsg('bot', 'Здравствуйте! Подберу для вас идеальную мебель и закреплю подарок 🎁\nКакую мебель рассматриваете?');
      
      // Сохраняем приветственное сообщение в историю
      const history = loadHistory();
      history.push({ role: 'assistant', content: 'Здравствуйте! Подберу для вас идеальную мебель и закреплю подарок 🎁\nКакую мебель рассматриваете?', ts: nowIso() });
      saveHistory(history);
      
      // Показываем кнопки категорий мгновенно
      setTimeout(() => showCategoryButtons(), 100);
      
      // Загружаем данные в фоне, если они еще не загружены
      if (!PROMPT) {
        fetchPrompt().catch(e => {
          if (DEBUG) console.warn('Failed to load prompt:', e);
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
          setTimeout(() => showCategoryButtons(), 100);
        }
      }
      
      // Восстанавливаем форму если она была предложена
      const lastBotMessage = loadHistory().filter(m => m.role === 'assistant').slice(-1)[0];
      if (lastBotMessage && shouldShowForm(lastBotMessage.content)) {
        // Проверяем паузу между показами форм (минимум 2 реплики клиента)
        const isDirectRequest = isDirectFormRequest(lastBotMessage.content);
        if (!bypassFormPause && !isDirectRequest && lastFormShownAt > 0 && userMessagesAfterLastForm < 2) {
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
      if (DEBUG) console.log('User message sent, counter increased:', userMessagesAfterLastForm);
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
        
        // Обрабатываем новую логику на основе анализа сообщения
        if (response.detectedCategory) {
          // Категория определена из вопроса - сразу форма с подарками
          showGiftForm(response.detectedCategory);
        } else if (response.isProductQuestion) {
          // Вопрос про товары без категории - выбор категории
          showCategoryButtons();
          } else {
          // FAQ вопрос - бот ответил, теперь выбор категории
          showCategoryButtons();
        }
        
        // Если есть персонализированное сообщение с формой (старая логика для совместимости)
        if (response.formMessage) {
          addMsg('bot', response.formMessage);
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
    if (DEBUG) console.log('maybeOfferPhoneFlow pause check:', { lastFormShownAt, userMessagesAfterLastForm, bypassFormPause });
    
    // Обходим паузу для прямых просьб заполнить форму
    const isDirectRequest = isDirectFormRequest(botReply);
    if (DEBUG) console.log('Direct request check:', { botReply, isDirectRequest, bypassFormPause, lastFormShownAt, userMessagesAfterLastForm });
    if (!bypassFormPause && !isDirectRequest && lastFormShownAt > 0 && userMessagesAfterLastForm < 2) {
      if (DEBUG) console.log('maybeOfferPhoneFlow paused - not showing form');
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
    
    const hasInstallmentRequest = installmentKeywords.some(keyword => botReply.toLowerCase().includes(keyword));
    
    if (isDirectRequest || matchedTriggers.length > 0 || hasForceWords){
      
      if (hasInstallmentRequest) {
        // Показываем форму для рассрочки
        renderConsultationForm();
      } else {
        // Обычная форма с подарками (по умолчанию)
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
    if (DEBUG) console.log('renderForm called:', { title, lastFormShownAt, userMessagesAfterLastForm, bypassFormPause });
    
    // Обновляем состояние отслеживания показа формы
    lastFormShownAt = Date.now();
    userMessagesAfterLastForm = 0;
    bypassFormPause = false; // Сбрасываем флаг обхода паузы после показа формы
    if (DEBUG) console.log('Form shown - reset counters:', { lastFormShownAt, userMessagesAfterLastForm, bypassFormPause });
    
    const wrap = document.createElement('div'); 
    wrap.className='vfw-msg bot';
    
    
    const fieldsHtml = fields.map(field => {
      if (field.type === 'offer') {
        return `
          <div style="margin-bottom:12px;font-size:14px;color:#666">Выберите подарок:</div>
          <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">
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
      <div class="vfw-avatar"><img src="${WIDGET_BASE_URL}images/consultant.jpg" alt="bot"></div>
      <div class="bubble">
        <div style="font-weight:600;margin-bottom:6px">${title}</div>
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">
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
      const leadUrl = CONFIG.leadEndpoint || (CONFIG.openaiEndpoint ? CONFIG.openaiEndpoint.replace('/chat', '/lead') : WIDGET_BASE_URL + 'api/lead');
      await fetchWithRetry(leadUrl, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          timestamp: nowIso(),
          name,
          phone,
          pretext,
          page_url,
          session_id: SESSION_ID
        })
      }, 2); // 2 попытки для отправки лида
      submittedLeads.add(leadKey);
      
      // Трекинг успешной отправки формы
      trackEvent('form_submit');
      
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

  async function submitGiftLead(name, phone, category, gift, messenger, wishes = '') {
    // Check if offline
    if (!navigator.onLine) {
      addMsg('bot','Похоже, нет подключения к интернету. Попробуйте позже.');
      return;
    }

    const leadKey = `${phone}_${category}_${gift}_${Date.now()}`;
    if (submittedLeads.has(leadKey)) {
      addMsg('bot','Данные уже отправлены. Дизайнер свяжется с вами.');
      return;
    }
    
    const page_url = location.href;
    try{
      // Use retry logic for lead submission too
      const leadUrl = CONFIG.leadEndpoint || (CONFIG.openaiEndpoint ? CONFIG.openaiEndpoint.replace('/chat', '/lead') : WIDGET_BASE_URL + 'api/lead');
      await fetchWithRetry(leadUrl, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          timestamp: nowIso(),
          name,
          phone,
          category,
          gift,
          messenger,
          wishes,
          pretext: 'Запрос подборки мебели с подарком',
          page_url,
          session_id: SESSION_ID
        })
      }, 2); // 2 попытки для отправки лида
      submittedLeads.add(leadKey);
      
      // Трекинг успешной отправки формы
      trackEvent('form_submit');
      
      addMsg('bot','Спасибо! Дизайнер вышлет персональную подборку в мессенджер в самое ближайшее время.');
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


  // Инициализация
  (async function init(){
    checkWidgetVersion();
    
    // Трекинг загрузки страницы (только один раз)
    if (!pageViewTracked) {
      // Используем небольшую задержку для debounce
      setTimeout(() => {
        trackEvent('page_view');
        pageViewTracked = true;
      }, 1000);
    }
    
    // Подключаем триггеры СРАЗУ
    schedulePageCountTrigger();
    watchSpaRouting();
    setupExitIntent();
    setupScrollToBottomTrigger();
    
    // Показываем приветственную подсказку через 15 секунд
    setTimeout(() => {
      if (els.panel.getAttribute('data-open') !== '1' && canShowHints()) {
        showHintsWithAutoHide('Привет! 👋\nХотите подборку мебели для вашего интерьера со скидкой или подарком на выбор?');
      }
    }, 15000);
    
    // Загружаем данные в фоне
    fetchPrompt().catch(e => {
      if (DEBUG) console.warn('Failed to load prompt:', e);
    });
  })();
})();
