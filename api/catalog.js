// Модуль для работы с YML каталогом клиента
// Загружает каталог с внешнего URL, парсит XML, кеширует в памяти и фильтрует товары

// Кеш каталога в памяти
let catalogCache = null;
let lastFetchTime = null;
let lastUpdateHour = null;

const CATALOG_URL = 'https://nm-shop.by/index.php?route=extension/feed/yandex_yml_cht';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 часа
const MOSCOW_TIMEZONE = 'Europe/Moscow';
const UPDATE_HOUR = 18; // Обновление после 18:00 МСК

// Получение текущего времени по Москве
function getMoscowTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: MOSCOW_TIMEZONE }));
}

// Проверка, нужно ли обновить кеш
function shouldUpdateCache() {
  if (!catalogCache || !lastFetchTime) return true;
  
  const now = Date.now();
  const timeSinceLastFetch = now - lastFetchTime;
  
  // Если прошло больше 24 часов
  if (timeSinceLastFetch > CACHE_DURATION_MS) return true;
  
  // Проверяем, прошло ли 18:00 МСК с последнего обновления
  const moscowTime = getMoscowTime();
  const currentHour = moscowTime.getHours();
  
  // Если сейчас >= 18:00 и последнее обновление было до 18:00
  if (currentHour >= UPDATE_HOUR && (!lastUpdateHour || lastUpdateHour < UPDATE_HOUR)) {
    return true;
  }
  
  return false;
}

// Загрузка и парсинг YML каталога
async function fetchCatalog() {
  try {
    console.log('Загружаем каталог с', CATALOG_URL);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 секунд таймаут
    
    const response = await fetch(CATALOG_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WidgetBot/1.0)',
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const xmlText = await response.text();
    console.log('Каталог загружен, размер:', Math.round(xmlText.length / 1024), 'KB');
    
    return parseYML(xmlText);
  } catch (error) {
    console.error('Ошибка загрузки каталога:', error);
    throw error;
  }
}

// Парсинг YML в JSON структуру
function parseYML(xmlText) {
  // Простой XML парсер для браузера и Node.js
  let parser;
  if (typeof DOMParser !== 'undefined') {
    // Браузер
    parser = new DOMParser();
  } else {
    // Node.js (для локальной разработки)
    // В Vercel будет использоваться браузерный парсер
    return parseYMLNode(xmlText);
  }
  
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  
  // Проверка на ошибки парсинга
  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error('XML parsing error: ' + parserError.textContent);
  }
  
  // Извлекаем категории
  const categories = {};
  const categoryElements = xmlDoc.querySelectorAll('category');
  categoryElements.forEach(cat => {
    const id = cat.getAttribute('id');
    const name = cat.textContent.trim();
    categories[id] = name;
  });
  
  // Извлекаем товары
  const offers = [];
  const offerElements = xmlDoc.querySelectorAll('offer');
  
  offerElements.forEach(offer => {
    const offerId = offer.getAttribute('id');
    const available = offer.getAttribute('available') === 'true';
    
    if (!available) return; // Пропускаем недоступные товары
    
    const getTextContent = (selector) => {
      const el = offer.querySelector(selector);
      return el ? el.textContent.trim() : null;
    };
    
    const getParam = (paramName) => {
      const params = offer.querySelectorAll('param');
      for (let param of params) {
        if (param.getAttribute('name') === paramName) {
          return param.textContent.trim();
        }
      }
      return null;
    };
    
    // Извлекаем все параметры
    const params = {};
    const paramElements = offer.querySelectorAll('param');
    paramElements.forEach(param => {
      const name = param.getAttribute('name');
      const value = param.textContent.trim();
      if (name && value) {
        params[name] = value;
      }
    });
    
    const offerData = {
      id: offerId,
      name: getTextContent('name'),
      price: parseFloat(getTextContent('price')) || 0,
      oldPrice: parseFloat(getTextContent('oldprice')) || null,
      currency: getTextContent('currencyId') || 'BYN',
      categoryId: getTextContent('categoryId'),
      category: categories[getTextContent('categoryId')] || 'Без категории',
      url: getTextContent('url'),
      picture: getTextContent('picture'),
      description: getTextContent('description'),
      vendor: getTextContent('vendor'),
      model: getTextContent('model'),
      available: true,
      params: params
    };
    
    offers.push(offerData);
  });
  
  console.log('Распарсено товаров:', offers.length);
  console.log('Категорий:', Object.keys(categories).length);
  
  return {
    offers,
    categories,
    totalCount: offers.length,
    timestamp: new Date().toISOString()
  };
}

// Упрощенный парсер для Node.js (Vercel)
function parseYMLNode(xmlText) {
  // Простейший парсер для серверной среды
  const offers = [];
  const categories = {};
  
  // Извлекаем категории с помощью regex
  const categoryRegex = /<category id="([^"]+)">([^<]+)<\/category>/g;
  let match;
  while ((match = categoryRegex.exec(xmlText)) !== null) {
    categories[match[1]] = match[2].trim();
  }
  
  // Извлекаем офферы
  const offerRegex = /<offer[^>]*id="([^"]*)"[^>]*available="true"[^>]*>([\s\S]*?)<\/offer>/g;
  
  while ((match = offerRegex.exec(xmlText)) !== null) {
    const offerId = match[1];
    const offerContent = match[2];
    
    const extractTag = (tag) => {
      const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
      const m = offerContent.match(regex);
      return m ? m[1].trim() : null;
    };
    
    const extractParams = () => {
      const params = {};
      const paramRegex = /<param name="([^"]+)"[^>]*>([^<]*)<\/param>/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(offerContent)) !== null) {
        params[paramMatch[1]] = paramMatch[2].trim();
      }
      return params;
    };
    
    const categoryId = extractTag('categoryId');
    
    offers.push({
      id: offerId,
      name: extractTag('name'),
      price: parseFloat(extractTag('price')) || 0,
      oldPrice: parseFloat(extractTag('oldprice')) || null,
      currency: extractTag('currencyId') || 'BYN',
      categoryId: categoryId,
      category: categories[categoryId] || 'Без категории',
      url: extractTag('url'),
      picture: extractTag('picture'),
      description: extractTag('description'),
      vendor: extractTag('vendor'),
      model: extractTag('model'),
      available: true,
      params: extractParams()
    });
  }
  
  console.log('Распарсено товаров:', offers.length);
  
  return {
    offers,
    categories,
    totalCount: offers.length,
    timestamp: new Date().toISOString()
  };
}

// Получение каталога (с кешированием)
async function getCatalog() {
  if (shouldUpdateCache()) {
    console.log('Обновляем кеш каталога...');
    catalogCache = await fetchCatalog();
    lastFetchTime = Date.now();
    
    const moscowTime = getMoscowTime();
    lastUpdateHour = moscowTime.getHours();
  } else {
    console.log('Используем кешированный каталог');
  }
  
  return catalogCache;
}

// Определение категории из текста запроса
function detectCategory(query) {
  const queryLower = query.toLowerCase();
  
  const categoryKeywords = {
    'диван': ['диван', 'софа', 'кушетк'],
    'кровать': ['кровать', 'кровати', 'спальн', 'матрас'],
    'кухня': ['кухн', 'кухонн', 'гарнитур'],
    'шкаф': ['шкаф', 'гардероб', 'купе'],
    'стол': ['стол', 'столик', 'обеденн'],
    'стул': ['стул', 'стуль', 'табурет'],
    'кресло': ['кресл', 'подвесн', 'качел', 'кокон', 'подвесное кресло', 'подвесное', 'качели'],
    'пуф': ['пуф', 'банкет', 'оттоман', 'банкетка'],
    'тумба': ['тумб', 'комод'],
    'прихожая': ['прихож', 'вешалк'],
  };
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => queryLower.includes(keyword))) {
      return category;
    }
  }
  
  return null;
}

// Извлечение размеров из запроса
function extractDimensions(query) {
  const dimensions = [];
  
  // Паттерны: "200*95*95", "200x95x95", "200 на 95 на 95", "200 95 95"
  const patterns = [
    /(\d+)[*x×]\s*(\d+)[*x×]\s*(\d+)/g,  // 200*95*95, 200x95x95
    /(\d+)\s*на\s*(\d+)\s*на\s*(\d+)/g,   // 200 на 95 на 95
    /(\d+)\s+(\d+)\s+(\d+)/g,             // 200 95 95
    /(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*(\d+)/g // 200 x 95 x 95
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(query)) !== null) {
      const dims = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
      if (dims.every(d => d > 0 && d < 10000)) { // разумные размеры
        dimensions.push(dims);
      }
    }
  });
  
  return dimensions;
}

// Проверка совпадения размеров с допуском
function checkDimensionMatch(offerDimensions, queryDimensions, tolerance = 10) {
  if (!offerDimensions || offerDimensions.length === 0) return false;
  if (!queryDimensions || queryDimensions.length === 0) return false;
  
  return queryDimensions.some(queryDims => {
    return offerDimensions.some(offerDims => {
      if (offerDims.length !== queryDims.length) return false;
      
      return offerDims.every((dim, i) => {
        const diff = Math.abs(dim - queryDims[i]);
        return diff <= tolerance;
      });
    });
  });
}

// Извлечение размеров из параметров товара
function extractOfferDimensions(offer) {
  const dimensions = [];
  
  if (!offer.params) return dimensions;
  
  // Параметры с размерами
  const sizeParams = ['Размеры', 'Габариты ГхДхВ, см', 'Размер', 'Габариты кровати'];
  
  sizeParams.forEach(paramName => {
    const value = offer.params[paramName];
    if (!value) return;
    
    // Извлекаем числа из строки размеров
    const numbers = value.match(/\d+/g);
    if (numbers && numbers.length >= 2) {
      const dims = numbers.map(n => parseInt(n)).filter(n => n > 0 && n < 10000);
      if (dims.length >= 2) {
        dimensions.push(dims);
      }
    }
  });
  
  return dimensions;
}

// Фильтрация товаров по запросу
function filterOffers(catalog, query, filters = {}) {
  let filtered = [...catalog.offers];
  
  // Автоопределение категории из запроса
  const detectedCategory = detectCategory(query);
  if (detectedCategory) {
    console.log('Определена категория из запроса:', detectedCategory);
    filtered = filtered.filter(offer => 
      offer.category && offer.category.toLowerCase().includes(detectedCategory)
    );
  }
  
  // Фильтр по явно указанной категории
  if (filters.category) {
    filtered = filtered.filter(offer => 
      offer.category && offer.category.toLowerCase().includes(filters.category.toLowerCase())
    );
  }
  
  // Фильтр по ценовому диапазону
  if (filters.minPrice !== undefined) {
    filtered = filtered.filter(offer => offer.price >= filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    filtered = filtered.filter(offer => offer.price <= filters.maxPrice);
  }
  
  // Извлекаем размеры из запроса
  const queryDimensions = extractDimensions(query);
  
  // Улучшенная нормализация запроса
  const queryWords = query.toLowerCase()
    .split(/[\s,.-]+/)
    .filter(w => w.length > 2 || /^\d+$/.test(w)) // Сохраняем числа
    .map(word => {
      // Для чисел не обрезаем
      if (/^\d+$/.test(word)) {
        return word;
      }
      // Частичное совпадение - берем корень слова
      if (word.length > 4) {
        return word.substring(0, word.length - 2); // "подвесное" -> "подвес"
      }
      return word;
    });
  
  // Сохраняем полные слова для точного поиска
  const fullQueryWords = query.toLowerCase()
    .split(/[\s,.-]+/)
    .filter(w => w.length > 0);
  
  if (queryWords.length > 0 || queryDimensions.length > 0) {
    filtered = filtered.map(offer => {
      let relevanceScore = 0;
      const nameText = (offer.name || '').toLowerCase();
      const descText = (offer.description || '').toLowerCase();
      const paramsText = JSON.stringify(offer.params || {}).toLowerCase();
      
      // 1. Точное совпадение тканей/материалов (максимальный балл)
      if (offer.params) {
        const fabricParams = ['Ткань', 'Обивка', 'Материал'];
        fabricParams.forEach(paramName => {
          const paramValue = (offer.params[paramName] || '').toLowerCase();
          if (paramValue && fullQueryWords.some(word => paramValue.includes(word))) {
            relevanceScore += 10; // Максимальный балл за точное совпадение ткани
          }
        });
      }
      
      // 2. Поиск по размерам
      if (queryDimensions.length > 0) {
        const offerDimensions = extractOfferDimensions(offer);
        if (checkDimensionMatch(offerDimensions, queryDimensions)) {
          relevanceScore += 5; // Высокий балл за совпадение размеров
        }
      }
      
      // 3. Обычный поиск по ключевым словам
      queryWords.forEach(word => {
        // Совпадение в названии = 3 балла
        if (nameText.includes(word)) {
          relevanceScore += 3;
        }
        // Совпадение в параметрах = 2 балла
        if (paramsText.includes(word)) {
          relevanceScore += 2;
        }
        // Совпадение в описании = 1 балл
        if (descText.includes(word)) {
          relevanceScore += 1;
        }
      });
      
      // 4. Дополнительный поиск по полным словам (для точных совпадений)
      fullQueryWords.forEach(word => {
        if (word.length > 2) {
          if (nameText.includes(word)) {
            relevanceScore += 1; // Дополнительный балл за полное совпадение
          }
        }
      });
      
      return { ...offer, relevanceScore };
    }).filter(offer => offer.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
  
  // Fallback: если по категории ничего не найдено, ищем по всем товарам
  if (filtered.length === 0 && detectedCategory) {
    console.log('Fallback поиск по всем товарам');
    const allOffers = [...catalog.offers];
    if (queryWords.length > 0 || queryDimensions.length > 0) {
      filtered = allOffers.map(offer => {
        let relevanceScore = 0;
        const nameText = (offer.name || '').toLowerCase();
        const descText = (offer.description || '').toLowerCase();
        const paramsText = JSON.stringify(offer.params || {}).toLowerCase();
        
        // Применяем ту же логику поиска что и выше
        // 1. Точное совпадение тканей/материалов
        if (offer.params) {
          const fabricParams = ['Ткань', 'Обивка', 'Материал'];
          fabricParams.forEach(paramName => {
            const paramValue = (offer.params[paramName] || '').toLowerCase();
            if (paramValue && fullQueryWords.some(word => paramValue.includes(word))) {
              relevanceScore += 10;
            }
          });
        }
        
        // 2. Поиск по размерам
        if (queryDimensions.length > 0) {
          const offerDimensions = extractOfferDimensions(offer);
          if (checkDimensionMatch(offerDimensions, queryDimensions)) {
            relevanceScore += 5;
          }
        }
        
        // 3. Обычный поиск по ключевым словам
        queryWords.forEach(word => {
          if (nameText.includes(word)) relevanceScore += 3;
          if (paramsText.includes(word)) relevanceScore += 2;
          if (descText.includes(word)) relevanceScore += 1;
        });
        
        // 4. Дополнительный поиск по полным словам
        fullQueryWords.forEach(word => {
          if (word.length > 2 && nameText.includes(word)) {
            relevanceScore += 1;
          }
        });
        
        return { ...offer, relevanceScore };
      }).filter(offer => offer.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore);
    }
  }
  
  // Ограничиваем количество результатов
  const maxResults = filters.limit || 50;
  return filtered.slice(0, maxResults);
}

// Форматирование товаров для GPT
function formatOffersForGPT(offers) {
  return offers.map(offer => {
    let info = `- ${offer.name} — ${offer.price} ${offer.currency}`;
    
    if (offer.oldPrice && offer.oldPrice > offer.price) {
      info += ` (было: ${offer.oldPrice} ${offer.currency})`;
    }
    
    if (offer.description) {
      info += ` | ${offer.description}`;
    }
    
    // Добавляем ключевые параметры
    const importantParams = [];
    if (offer.params) {
      // Ткань/обивка (приоритет)
      if (offer.params['Ткань']) {
        importantParams.push(`Ткань: ${offer.params['Ткань']}`);
      }
      if (offer.params['Обивка']) {
        importantParams.push(`Обивка: ${offer.params['Обивка']}`);
      }
      
      // Размеры (приоритет)
      if (offer.params['Размеры']) {
        importantParams.push(`Размеры: ${offer.params['Размеры']}`);
      }
      if (offer.params['Габариты ГхДхВ, см']) {
        importantParams.push(`Габариты: ${offer.params['Габариты ГхДхВ, см']}`);
      }
      if (offer.params['Размер']) {
        importantParams.push(`Размер: ${offer.params['Размер']}`);
      }
      if (offer.params['Габариты кровати']) {
        importantParams.push(`Размер кровати: ${offer.params['Габариты кровати']}`);
      }
      
      // Механизмы и конфигурация
      if (offer.params['Механизм трансформации']) {
        importantParams.push(`Механизм: ${offer.params['Механизм трансформации']}`);
      }
      if (offer.params['Конфигурация']) {
        importantParams.push(`Конфигурация: ${offer.params['Конфигурация']}`);
      }
      
      // Другие важные параметры
      if (offer.params['Материал']) {
        importantParams.push(`Материал: ${offer.params['Материал']}`);
      }
      if (offer.params['Высота спального места от пола']) {
        importantParams.push(`Высота: ${offer.params['Высота спального места от пола']}`);
      }
    }
    
    if (importantParams.length > 0) {
      info += ` | ${importantParams.join(', ')}`;
    }
    
    if (offer.url) {
      info += ` (${offer.url})`;
    }
    
    return info;
  }).join('\n');
}

// API handler
async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { action, query, filters } = req.body || {};
    
    if (action === 'search') {
      // Получаем каталог (с кешированием)
      const catalog = await getCatalog();
      
      // Фильтруем товары
      const filteredOffers = filterOffers(catalog, query || '', filters || {});
      
      // Форматируем для GPT
      const formattedOffers = formatOffersForGPT(filteredOffers);
      
      return res.status(200).json({
        success: true,
        totalFound: filteredOffers.length,
        offers: filteredOffers,
        formattedForGPT: formattedOffers,
        catalogInfo: {
          totalOffers: catalog.totalCount,
          categories: Object.values(catalog.categories),
          lastUpdate: catalog.timestamp
        }
      });
    }
    
    if (action === 'stats') {
      // Статистика каталога
      const catalog = await getCatalog();
      
      return res.status(200).json({
        success: true,
        totalOffers: catalog.totalCount,
        categories: catalog.categories,
        lastUpdate: catalog.timestamp,
        cacheInfo: {
          lastFetchTime: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
          lastUpdateHour: lastUpdateHour
        }
      });
    }
    
    return res.status(400).json({ error: 'Invalid action. Use "search" or "stats"' });
    
  } catch (error) {
    console.error('Ошибка в catalog.js:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

module.exports = handler;

