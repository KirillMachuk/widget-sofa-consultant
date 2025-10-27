// Модуль для работы с YML каталогом клиента
// Загружает каталог с внешнего URL, парсит XML, кеширует в Upstash Redis и фильтрует товары

// Импорт Upstash Redis
const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const CATALOG_URL = 'https://nm-shop.by/index.php?route=extension/feed/yandex_yml_cht';
const CATALOG_CACHE_KEY = 'catalog:main';
const CATALOG_METADATA_KEY = 'catalog:metadata';
const CACHE_DURATION_SECONDS = 24 * 60 * 60; // 24 часа
const FETCH_TIMEOUT_MS = 8000; // 8 секунд - успеем до лимита Vercel

// Получение каталога из KV или загрузка нового
async function getCatalog() {
  try {
    // 1. Пробуем загрузить из Redis
    const cached = await redis.get(CATALOG_CACHE_KEY);
    const metadata = await redis.get(CATALOG_METADATA_KEY);
    
    if (cached && metadata) {
      console.log('✅ Каталог загружен из Redis:', {
        totalOffers: cached.totalCount,
        lastUpdate: metadata.lastUpdate,
        age: Date.now() - metadata.timestamp
      });
      return cached;
    }
    
    // 2. Если нет в Redis - загружаем с сайта
    console.log('⚠️ Каталог не найден в Redis, загружаем с сайта...');
    const freshCatalog = await fetchCatalog();
    
    // 3. Сохраняем в Redis на 24 часа
    await redis.setex(CATALOG_CACHE_KEY, CACHE_DURATION_SECONDS, freshCatalog);
    await redis.setex(CATALOG_METADATA_KEY, CACHE_DURATION_SECONDS, {
      lastUpdate: freshCatalog.timestamp,
      timestamp: Date.now()
    });
    
    console.log('✅ Каталог загружен с сайта и сохранен в Redis');
    return freshCatalog;
    
  } catch (error) {
    console.error('❌ Ошибка работы с каталогом:', error);
    
    // Fallback: пробуем загрузить хоть старый каталог из Redis (игнорируя срок)
    try {
      const oldCached = await redis.get(CATALOG_CACHE_KEY);
      if (oldCached) {
        console.log('⚠️ Используем устаревший каталог из Redis (graceful degradation)');
        // Помечаем что каталог устаревший, но все равно используем
        oldCached.isStale = true;
        oldCached.fallbackReason = 'Fresh catalog unavailable, using cached version';
        return oldCached;
      }
    } catch (redisError) {
      console.error('❌ Redis также недоступен');
    }
    
    // Если совсем ничего не работает - возвращаем пустой каталог
    console.log('❌ Полный fallback: каталог недоступен');
    return {
      offers: [],
      categories: {},
      totalCount: 0,
      timestamp: new Date().toISOString(),
      error: 'Catalog unavailable',
      isStale: true,
      fallbackReason: 'No catalog data available'
    };
  }
}

// Загрузка каталога с сайта с retry логикой
async function fetchCatalog() {
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS); // 8 секунд
    
    try {
      console.log(`📥 Загружаем каталог с ${CATALOG_URL} (попытка ${attempt}/${maxRetries})`);
      
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
      console.log(`✅ Каталог загружен, размер: ${Math.round(xmlText.length / 1024)} KB`);
      
      return parseYML(xmlText);
    } catch (error) {
      console.error(`❌ Ошибка загрузки каталога (попытка ${attempt}/${maxRetries}):`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Экспоненциальная задержка: 1s, 2s, 4s
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.log(`⏳ Повторная попытка через ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
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

// Старая функция удалена - теперь используется новая getCatalog() с KV

// Определение категории из текста запроса
function detectCategory(query) {
  const queryLower = query.toLowerCase();
  console.log(`🔍 detectCategory: анализируем запрос "${query}"`);
  
  // ПРИОРИТЕТ: если есть конкретный предмет мебели - используем его
  const furnitureKeywords = {
    'стул': ['стул', 'стуль', 'табурет', 'стула', 'стулья', 'стульев', 'стулом', 'стулами', 'стульями'],
    'стол': ['стол', 'столик', 'обеденн', 'стола', 'столы', 'столов', 'столом', 'столами'],
    'диван': ['диван', 'софа', 'кушетк', 'дивана', 'диваны', 'диванов', 'диваном', 'диванами'],
    'кресло': ['кресл', 'подвесн', 'качел', 'кокон', 'подвесное кресло', 'подвесное', 'качели', 'кресла', 'кресел', 'креслом', 'креслами'],
    'кровать': ['кровать', 'кровати', 'спальн', 'матрас', 'кроватей', 'кроватью', 'кроватями'],
    'шкаф': ['шкаф', 'гардероб', 'купе', 'шкафа', 'шкафы', 'шкафов', 'шкафом', 'шкафами'],
    'пуф': ['пуф', 'банкет', 'оттоман', 'банкетка', 'пуфа', 'пуфы', 'пуфов', 'пуфом', 'пуфами'],
    'тумба': ['тумб', 'комод', 'тумбы', 'тумбой', 'тумбами'],
  };
  
  // СНАЧАЛА ищем конкретную мебель (приоритет)
  for (const [category, keywords] of Object.entries(furnitureKeywords)) {
    const foundKeywords = keywords.filter(keyword => queryLower.includes(keyword));
    if (foundKeywords.length > 0) {
      console.log(`🔍 detectCategory: найдена мебель "${category}" по ключевым словам:`, foundKeywords);
      console.log(`📝 Полный запрос:`, query);
      return category;
    }
  }
  
  // ПОТОМ ищем комнаты (если нет конкретной мебели)
  const roomKeywords = {
    'кухня': ['кухн', 'кухонн', 'гарнитур'],
    'прихожая': ['прихож', 'вешалк', 'прихожей', 'прихожую'],
  };
  
  for (const [category, keywords] of Object.entries(roomKeywords)) {
    const foundKeywords = keywords.filter(keyword => queryLower.includes(keyword));
    if (foundKeywords.length > 0) {
      console.log(`🔍 detectCategory: найдена комната "${category}" по ключевым словам:`, foundKeywords);
      console.log(`📝 Полный запрос:`, query);
      return category;
    }
  }
  
  console.log('⚠️ detectCategory: категория НЕ найдена в запросе:', query);
  console.log('🔍 Доступные ключевые слова для стульев:', furnitureKeywords['стул']);
  return null;
}

// Извлечение количества из запроса
function extractQuantity(query) {
  const queryLower = query.toLowerCase();
  
  // Паттерны: "4 стула", "нужен 3 стула", "купить 5 стульев"
  const patterns = [
    /(\d+)\s*(?:стул|стуль|стула|стульев|стулья|кресл|диван|стол)/i,
    /(?:нужен|нужно|купить|хочу)\s*(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      const quantity = parseInt(match[1]);
      console.log(`🔢 extractQuantity: найдено количество ${quantity} в запросе:`, query.substring(0, 100));
      return quantity;
    }
  }
  
  console.log(`🔢 extractQuantity: количество не найдено, используем 1 для запроса:`, query.substring(0, 100));
  return 1; // По умолчанию 1 штука
}

// Расчет цены за единицу товара
function getPricePerUnit(offer) {
  const name = (offer.name || '').toLowerCase();
  
  // Ищем "2 шт", "3 шт" и т.д. в названии
  const match = name.match(/(\d+)\s*шт/);
  if (match) {
    const quantity = parseInt(match[1]);
    const pricePerUnit = offer.price / quantity;
    console.log(`💰 getPricePerUnit: ${offer.name} - ${offer.price} BYN за ${quantity} шт = ${pricePerUnit.toFixed(0)} BYN/шт`);
    return pricePerUnit;
  }
  
  console.log(`💰 getPricePerUnit: ${offer.name} - ${offer.price} BYN за 1 шт`);
  return offer.price; // Цена за 1 шт
}

// Определение намерения пользователя по цене
function detectPriceIntent(query) {
  const queryLower = query.toLowerCase();
  
  if (queryLower.includes('самый дешевый') || 
      queryLower.includes('самый дешёвый') ||
      queryLower.includes('дешевле всего') ||
      queryLower.includes('минимальная цена') ||
      queryLower.includes('самый дешевый стул') ||
      queryLower.includes('самый дешевый диван')) {
    console.log(`🎯 detectPriceIntent: найден запрос на самый дешевый в:`, query.substring(0, 100));
    return 'cheapest'; // Показать только самый дешевый
  }
  
  console.log(`🎯 detectPriceIntent: запрос на разнообразие в:`, query.substring(0, 100));
  return 'variety'; // Показать разнообразие (дешевый + средний + дорогой)
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

// Извлечение ценового диапазона из запроса
function extractPriceRange(query) {
  const queryLower = query.toLowerCase();
  const priceRange = { minPrice: null, maxPrice: null };
  
  // НОВОЕ: Проверяем валюту - если написано "руб" без "BYN", предполагаем BYN
  const hasBYN = /byn|белорусск|бел\.руб/i.test(queryLower);
  const hasRUB = /руб|рубл/i.test(queryLower);
  
  // Паттерны для цен
  const patterns = [
    // "до 1000", "до 1000 рублей", "дешевле 1000"
    /(?:до|дешевле|не дороже|максимум)\s*(\d+)/g,
    // "от 500", "от 500 рублей", "дороже 500"
    /(?:от|дороже|минимум)\s*(\d+)/g,
    // "от 500 до 1500", "в пределах 500-1500", "500-1500"
    /(?:от\s*(\d+)\s*до\s*(\d+)|в пределах\s*(\d+)-(\d+)|(\d+)-(\d+))/g,
    // "в бюджете 1500-2000"
    /в бюджете\s*(\d+)-(\d+)/g
  ];
  
  // Обработка паттернов
  patterns.forEach((pattern, index) => {
    let match;
    while ((match = pattern.exec(queryLower)) !== null) {
      if (index === 0) { // "до X"
        priceRange.maxPrice = parseInt(match[1]);
      } else if (index === 1) { // "от X"
        priceRange.minPrice = parseInt(match[1]);
      } else if (index === 2) { // "от X до Y"
        if (match[1] && match[2]) {
          priceRange.minPrice = parseInt(match[1]);
          priceRange.maxPrice = parseInt(match[2]);
        } else if (match[3] && match[4]) {
          priceRange.minPrice = parseInt(match[3]);
          priceRange.maxPrice = parseInt(match[4]);
        } else if (match[5] && match[6]) {
          priceRange.minPrice = parseInt(match[5]);
          priceRange.maxPrice = parseInt(match[6]);
        }
      } else if (index === 3) { // "в бюджете X-Y"
        priceRange.minPrice = parseInt(match[1]);
        priceRange.maxPrice = parseInt(match[2]);
      }
    }
  });
  
  // Синонимы для ценовых категорий
  if (queryLower.includes('дешевый') || queryLower.includes('недорогой') || queryLower.includes('бюджетный')) {
    priceRange.maxPrice = 1000;
  }
  if (queryLower.includes('дорогой') || queryLower.includes('премиум') || queryLower.includes('элитный')) {
    priceRange.minPrice = 3000;
  }
  
  // НОВОЕ: Если цена очень низкая и написано "руб", предполагаем что это BYN
  if (hasRUB && !hasBYN) {
    // Пользователь написал "руб" без уточнения - это скорее всего BYN
    // Не делаем ничего - цены уже правильные
    console.log('💰 Обнаружена цена в рублях, предполагаем BYN');
  }
  
  return priceRange;
}

// Извлечение размеров спального места
function extractSleepingPlace(query) {
  const queryLower = query.toLowerCase();
  const sleepingPlaces = [];
  
  // Паттерны для спального места
  const patterns = [
    /спальное место\s*(\d+)\s*на\s*(\d+)/g,
    /спальное место\s*(\d+)\s*x\s*(\d+)/g,
    /спальное место\s*(\d+)\s*×\s*(\d+)/g,
    /(\d+)\s*на\s*(\d+)\s*спальное место/g,
    /(\d+)\s*x\s*(\d+)\s*спальное место/g
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(queryLower)) !== null) {
      const width = parseInt(match[1]);
      const length = parseInt(match[2]);
      if (width > 0 && length > 0 && width < 300 && length < 300) {
        sleepingPlaces.push([width, length]);
      }
    }
  });
  
  // Специальные фразы
  if (queryLower.includes('для сна двоих') || queryLower.includes('двуспальная')) {
    sleepingPlaces.push([160, 200]); // Минимальные размеры для двоих
  }
  if (queryLower.includes('односпальная') || queryLower.includes('для одного')) {
    sleepingPlaces.push([90, 200]); // Стандартные размеры для одного
  }
  
  return sleepingPlaces;
}

// Определение комнаты/назначения
function detectRoom(query) {
  const queryLower = query.toLowerCase();
  
  const roomKeywords = {
    'гостиная': ['гостиная', 'зал', 'зал для гостей', 'гостиная комната'],
    'спальня': ['спальня', 'спальная', 'спальная комната', 'для сна'],
    'кухня': ['кухня', 'кухонная', 'кухонный', 'для кухни'],
    'детская': ['детская', 'детская комната', 'для детей', 'ребенок'],
    'прихожая': ['прихожая', 'коридор', 'входная', 'для прихожей'],
    'офис': ['офис', 'рабочее место', 'кабинет', 'для работы']
  };
  
  for (const [room, keywords] of Object.entries(roomKeywords)) {
    if (keywords.some(keyword => queryLower.includes(keyword))) {
      return room;
    }
  }
  
  return null;
}

// Словарь синонимов цветов
function getColorSynonyms(color) {
  const colorLower = color.toLowerCase();
  
  const colorSynonyms = {
    'темный': ['черный', 'графит', 'антрацит', 'венге', 'темно-коричневый', 'темно-серый', 'угольный'],
    'светлый': ['белый', 'кремовый', 'бежевый', 'молочный', 'айвори', 'светло-серый', 'светло-коричневый'],
    'яркий': ['красный', 'синий', 'желтый', 'зеленый', 'оранжевый', 'фиолетовый', 'розовый'],
    'нейтральный': ['серый', 'коричневый', 'бежевый', 'тауп', 'графит', 'сталь']
  };
  
  for (const [category, synonyms] of Object.entries(colorSynonyms)) {
    if (synonyms.some(synonym => colorLower.includes(synonym))) {
      return synonyms;
    }
  }
  
  return [color];
}

// Словарь синонимов механизмов
function getMechanismSynonyms(mechanism) {
  const mechanismLower = mechanism.toLowerCase();
  
  if (mechanismLower.includes('раскладной') || mechanismLower.includes('раскладывающийся')) {
    return ['еврокнижка', 'книжка', 'аккордеон', 'выкатной', 'пантограф', 'дельфин', 'клик-кляк'];
  }
  
  if (mechanismLower.includes('не раскладной') || mechanismLower.includes('стационарный') || mechanismLower.includes('без механизма')) {
    return ['нет', 'трансформации: отсутствует', 'механизм трансформации (раскладки) - нет'];
  }
  
  return [mechanism];
}

// Извлечение требований к нагрузке
function extractMaxLoad(query) {
  const queryLower = query.toLowerCase();
  
  // Паттерны для нагрузки
  const patterns = [
    /максимальная нагрузка\s*(\d+)/g,
    /нагрузка\s*(\d+)/g,
    /выдержит\s*(\d+)/g,
    /большой вес\s*(\d+)/g
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(queryLower);
    if (match) {
      return parseInt(match[1]);
    }
  }
  
  // Специальные фразы
  if (queryLower.includes('большой вес') || queryLower.includes('тяжелый')) {
    return 150; // Минимальная нагрузка для "большого веса"
  }
  
  return null;
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
  console.log(`📊 filterOffers START: всего товаров в каталоге: ${filtered.length}`);
  console.log(`🔍 Поисковый запрос: "${query}"`);
  console.log(`📋 Фильтры:`, filters);
  
  // Автоопределение категории из запроса
  const detectedCategory = detectCategory(query);
  if (detectedCategory) {
    console.log('✅ Определена категория из запроса:', detectedCategory);
    
    // Логируем все уникальные категории в каталоге для диагностики
    const allCategories = [...new Set(catalog.offers.map(o => o.category).filter(Boolean))];
    console.log('📋 Все категории в каталоге:', allCategories.slice(0, 10));
    
    // Ищем товары с похожими категориями
    const similarCategories = allCategories.filter(cat => 
      cat.toLowerCase().includes(detectedCategory) || 
      detectedCategory.includes(cat.toLowerCase())
    );
    console.log(`🔍 Похожие категории для "${detectedCategory}":`, similarCategories);
    
    filtered = filtered.filter(offer => 
      offer.category && offer.category.toLowerCase().includes(detectedCategory)
    );
    console.log(`📊 После фильтра по категории "${detectedCategory}": ${filtered.length} товаров`);
  } else {
    console.log('⚠️ Категория НЕ определена - используем все товары');
  }
  
  // Фильтр по явно указанной категории
  if (filters.category) {
    filtered = filtered.filter(offer => 
      offer.category && offer.category.toLowerCase().includes(filters.category.toLowerCase())
    );
  }
  
  // Извлекаем все параметры из запроса
  const queryDimensions = extractDimensions(query);
  const priceRange = extractPriceRange(query);
  const sleepingPlaces = extractSleepingPlace(query);
  const detectedRoom = detectRoom(query);
  const maxLoad = extractMaxLoad(query);
  
  // Логирование извлеченного priceRange
  console.log('💰 Извлечен priceRange:', {
    minPrice: priceRange.minPrice,
    maxPrice: priceRange.maxPrice,
    query: query.substring(0, 100)
  });
  
  // Фильтр по ценовому диапазону (из filters)
  if (filters.minPrice !== undefined) {
    filtered = filtered.filter(offer => offer.price >= filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    filtered = filtered.filter(offer => offer.price <= filters.maxPrice);
  }
  
  // Фильтр по ценовому диапазону (из запроса)
  if (priceRange.minPrice !== null) {
    filtered = filtered.filter(offer => offer.price >= priceRange.minPrice);
  }
  if (priceRange.maxPrice !== null) {
    filtered = filtered.filter(offer => offer.price <= priceRange.maxPrice);
  }
  
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
  
  if (queryWords.length > 0 || queryDimensions.length > 0 || priceRange.minPrice || priceRange.maxPrice || sleepingPlaces.length > 0 || detectedRoom || maxLoad) {
    filtered = filtered.map(offer => {
      let relevanceScore = 0;
      const nameText = (offer.name || '').toLowerCase();
      const descText = (offer.description || '').toLowerCase();
      const paramsText = JSON.stringify(offer.params || {}).toLowerCase();
      
      // 1. Точное совпадение тканей/материалов
      if (offer.params) {
        const fabricParams = ['Ткань', 'Обивка', 'Материал'];
        fabricParams.forEach(paramName => {
          const paramValue = (offer.params[paramName] || '').toLowerCase();
          if (paramValue && fullQueryWords.some(word => paramValue.includes(word))) {
            relevanceScore += 5; // Нормализовано с 10 до 5
          }
        });
      }
      
      // 2. Поиск по цвету с синонимами
      if (offer.params && offer.params['Цвет']) {
        const offerColor = offer.params['Цвет'].toLowerCase();
        fullQueryWords.forEach(word => {
          const colorSynonyms = getColorSynonyms(word);
          if (colorSynonyms.some(synonym => offerColor.includes(synonym.toLowerCase()))) {
            relevanceScore += 5; // Нормализовано с 8 до 5
          }
        });
      }
      
      // 3. Поиск по механизму с синонимами
      if (offer.params) {
        const mechanismParams = ['Механизм трансформации', 'Механизм'];
        mechanismParams.forEach(paramName => {
          const paramValue = (offer.params[paramName] || '').toLowerCase();
          fullQueryWords.forEach(word => {
            const mechanismSynonyms = getMechanismSynonyms(word);
            if (mechanismSynonyms.some(synonym => paramValue.includes(synonym.toLowerCase()))) {
              relevanceScore += 5; // Нормализовано с 7 до 5
            }
          });
        });
      }
      
      // 4. Поиск по спальному месту
      if (sleepingPlaces.length > 0 && offer.params && offer.params['Спальное место, см']) {
        const sleepingPlaceValue = offer.params['Спальное место, см'];
        const numbers = sleepingPlaceValue.match(/\d+/g);
        if (numbers && numbers.length >= 2) {
          const offerPlace = [parseInt(numbers[0]), parseInt(numbers[1])];
          sleepingPlaces.forEach(queryPlace => {
            if (Math.abs(offerPlace[0] - queryPlace[0]) <= 5 && Math.abs(offerPlace[1] - queryPlace[1]) <= 5) {
              relevanceScore += 5; // Нормализовано с 6 до 5
            }
          });
        }
      }
      
      // 5. Поиск по конфигурации
      if (offer.params && offer.params['Конфигурация']) {
        const configValue = offer.params['Конфигурация'].toLowerCase();
        fullQueryWords.forEach(word => {
          if (word.includes('угловой') && configValue.includes('угловой')) {
            relevanceScore += 5; // Нормализовано с 6 до 5
          } else if (word.includes('прямой') && configValue.includes('прямой')) {
            relevanceScore += 5; // Нормализовано с 6 до 5
          } else if (word.includes('модульный') && configValue.includes('модуль')) {
            relevanceScore += 5; // Нормализовано с 6 до 5
          }
        });
      }
      
      // 6. Поиск по функциям (+5 баллов)
      if (offer.params) {
        const functionParams = {
          'ящик': 'Ящик для белья',
          'подъемный': 'Подъемный механизм',
          'ортопедическое': 'Ортопедческое основание'
        };
        
        Object.entries(functionParams).forEach(([keyword, paramName]) => {
          if (fullQueryWords.some(word => word.includes(keyword)) && offer.params[paramName]) {
            relevanceScore += 5;
          }
        });
      }
      
      // 7. Поиск по назначению/комнате (+5 баллов)
      if (detectedRoom) {
        const roomCategories = {
          'гостиная': ['диван', 'стол', 'кресло', 'тумба'],
          'спальня': ['кровать', 'шкаф', 'комод', 'тумба'],
          'кухня': ['кухня', 'стол', 'стул'],
          'детская': ['кровать', 'шкаф', 'стол'],
          'прихожая': ['прихожая', 'вешалка', 'тумба']
        };
        
        const expectedCategories = roomCategories[detectedRoom] || [];
        if (expectedCategories.some(cat => offer.category && offer.category.toLowerCase().includes(cat))) {
          relevanceScore += 5;
        }
      }
      
      // 8. Поиск по размерам (+5 баллов)
      if (queryDimensions.length > 0) {
        const offerDimensions = extractOfferDimensions(offer);
        if (checkDimensionMatch(offerDimensions, queryDimensions)) {
          relevanceScore += 5;
        }
      }
      
      // 9. Поиск со скидкой (+4 балла)
      if (offer.oldPrice && offer.oldPrice > offer.price) {
        if (fullQueryWords.some(word => ['скидка', 'акция', 'распродажа', 'уценка'].includes(word))) {
          relevanceScore += 4;
        }
      }
      
      // 10. Поиск по материалу каркаса (+4 балла)
      if (offer.params && offer.params['Материал каркаса']) {
        const frameMaterial = offer.params['Материал каркаса'].toLowerCase();
        fullQueryWords.forEach(word => {
          if (word.includes('дерево') && (frameMaterial.includes('брус') || frameMaterial.includes('фанера') || frameMaterial.includes('массив'))) {
            relevanceScore += 4;
          } else if (word.includes('металл') && (frameMaterial.includes('металл') || frameMaterial.includes('сталь'))) {
            relevanceScore += 4;
          }
        });
      }
      
      // 11. Поиск по нагрузке (+4 балла)
      if (maxLoad && offer.params && offer.params['Максимальная нагрузка']) {
        const offerLoad = parseInt(offer.params['Максимальная нагрузка']);
        if (offerLoad >= maxLoad) {
          relevanceScore += 4;
        }
      }
      
      // 12. Поиск по жесткости (+4 балла)
      if (offer.params && offer.params['Уровень жесткости']) {
        const stiffness = offer.params['Уровень жесткости'].toLowerCase();
        fullQueryWords.forEach(word => {
          if (word.includes('жесткий') && stiffness.includes('жесткий')) {
            relevanceScore += 4;
          } else if (word.includes('мягкий') && stiffness.includes('мягкий')) {
            relevanceScore += 4;
          }
        });
      }
      
      // 13. Обычный поиск по ключевым словам
      queryWords.forEach(word => {
        // Совпадение в названии = 5 баллов (категория)
        if (nameText.includes(word)) {
          relevanceScore += 5; // Нормализовано с 3 до 5
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
      
      // 14. Дополнительный поиск по полным словам - убираем (избыточно)
      
      // 15. НОВОЕ: Баллы за соответствие бюджету
      if (priceRange.maxPrice) {
        const pricePerUnit = getPricePerUnit(offer);
        const totalPrice = pricePerUnit * requestedQuantity;
        
        if (totalPrice <= priceRange.maxPrice) {
          relevanceScore += 5; // +5 баллов за соответствие бюджету
          console.log(`💰 ${offer.name}: в бюджете (${totalPrice} <= ${priceRange.maxPrice})`);
        }
      }
      
      return { ...offer, relevanceScore };
    }).filter(offer => offer.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
  
  // Fallback: если ничего не найдено с фильтрами - ищем без цены
  if (filtered.length === 0 && detectedCategory && (priceRange.minPrice || priceRange.maxPrice)) {
    console.log('⚠️ Fallback поиск без фильтра по цене');
    
    filtered = catalog.offers
      .filter(offer => offer.category && offer.category.toLowerCase().includes(detectedCategory))
      .sort((a, b) => a.price - b.price) // Сортируем по цене
      .slice(0, 20); // Берём топ-20 самых дешевых
  }
  
  // Fallback: если по категории ничего не найдено, ищем по всем товарам
  if (filtered.length === 0 && detectedCategory) {
    console.log('Fallback поиск по всем товарам');
    const allOffers = [...catalog.offers];
    if (queryWords.length > 0 || queryDimensions.length > 0 || priceRange.minPrice || priceRange.maxPrice || sleepingPlaces.length > 0 || detectedRoom || maxLoad) {
      filtered = allOffers.map(offer => {
        let relevanceScore = 0;
        const nameText = (offer.name || '').toLowerCase();
        const descText = (offer.description || '').toLowerCase();
        const paramsText = JSON.stringify(offer.params || {}).toLowerCase();
        
        // Применяем ту же расширенную логику поиска что и выше
        // (копируем всю логику из основного поиска)
        
        // 1. Точное совпадение тканей/материалов
        if (offer.params) {
          const fabricParams = ['Ткань', 'Обивка', 'Материал'];
          fabricParams.forEach(paramName => {
            const paramValue = (offer.params[paramName] || '').toLowerCase();
            if (paramValue && fullQueryWords.some(word => paramValue.includes(word))) {
              relevanceScore += 5; // Нормализовано с 10 до 5
            }
          });
        }
        
        // 2. Поиск по цвету с синонимами
        if (offer.params && offer.params['Цвет']) {
          const offerColor = offer.params['Цвет'].toLowerCase();
          fullQueryWords.forEach(word => {
            const colorSynonyms = getColorSynonyms(word);
            if (colorSynonyms.some(synonym => offerColor.includes(synonym.toLowerCase()))) {
              relevanceScore += 5; // Нормализовано с 8 до 5
            }
          });
        }
        
        // 3. Поиск по механизму с синонимами
        if (offer.params) {
          const mechanismParams = ['Механизм трансформации', 'Механизм'];
          mechanismParams.forEach(paramName => {
            const paramValue = (offer.params[paramName] || '').toLowerCase();
            fullQueryWords.forEach(word => {
              const mechanismSynonyms = getMechanismSynonyms(word);
              if (mechanismSynonyms.some(synonym => paramValue.includes(synonym.toLowerCase()))) {
                relevanceScore += 5; // Нормализовано с 7 до 5
              }
            });
          });
        }
        
        // 4. Поиск по спальному месту
        if (sleepingPlaces.length > 0 && offer.params && offer.params['Спальное место, см']) {
          const sleepingPlaceValue = offer.params['Спальное место, см'];
          const numbers = sleepingPlaceValue.match(/\d+/g);
          if (numbers && numbers.length >= 2) {
            const offerPlace = [parseInt(numbers[0]), parseInt(numbers[1])];
            sleepingPlaces.forEach(queryPlace => {
              if (Math.abs(offerPlace[0] - queryPlace[0]) <= 5 && Math.abs(offerPlace[1] - queryPlace[1]) <= 5) {
                relevanceScore += 5; // Нормализовано с 6 до 5
              }
            });
          }
        }
        
        // 5. Поиск по конфигурации
        if (offer.params && offer.params['Конфигурация']) {
          const configValue = offer.params['Конфигурация'].toLowerCase();
          fullQueryWords.forEach(word => {
            if (word.includes('угловой') && configValue.includes('угловой')) {
              relevanceScore += 5; // Нормализовано с 6 до 5
            } else if (word.includes('прямой') && configValue.includes('прямой')) {
              relevanceScore += 5; // Нормализовано с 6 до 5
            } else if (word.includes('модульный') && configValue.includes('модуль')) {
              relevanceScore += 5; // Нормализовано с 6 до 5
            }
          });
        }
        
        // 6. Поиск по функциям
        if (offer.params) {
          const functionParams = {
            'ящик': 'Ящик для белья',
            'подъемный': 'Подъемный механизм',
            'ортопедическое': 'Ортопедческое основание'
          };
          
          Object.entries(functionParams).forEach(([keyword, paramName]) => {
            if (fullQueryWords.some(word => word.includes(keyword)) && offer.params[paramName]) {
              relevanceScore += 5;
            }
          });
        }
        
        // 7. Поиск по назначению/комнате
        if (detectedRoom) {
          const roomCategories = {
            'гостиная': ['диван', 'стол', 'кресло', 'тумба'],
            'спальня': ['кровать', 'шкаф', 'комод', 'тумба'],
            'кухня': ['кухня', 'стол', 'стул'],
            'детская': ['кровать', 'шкаф', 'стол'],
            'прихожая': ['прихожая', 'вешалка', 'тумба']
          };
          
          const expectedCategories = roomCategories[detectedRoom] || [];
          if (expectedCategories.some(cat => offer.category && offer.category.toLowerCase().includes(cat))) {
            relevanceScore += 5;
          }
        }
        
        // 8. Поиск по размерам
        if (queryDimensions.length > 0) {
          const offerDimensions = extractOfferDimensions(offer);
          if (checkDimensionMatch(offerDimensions, queryDimensions)) {
            relevanceScore += 5;
          }
        }
        
      // 9. Поиск со скидкой
      if (offer.oldPrice && offer.oldPrice > offer.price) {
        if (fullQueryWords.some(word => ['скидка', 'акция', 'распродажа', 'уценка'].includes(word))) {
          relevanceScore += 3; // Нормализовано с 4 до 3 (дополнительный критерий)
        }
      }
        
        // 10. Поиск по материалу каркаса
        if (offer.params && offer.params['Материал каркаса']) {
          const frameMaterial = offer.params['Материал каркаса'].toLowerCase();
          fullQueryWords.forEach(word => {
            if (word.includes('дерево') && (frameMaterial.includes('брус') || frameMaterial.includes('фанера') || frameMaterial.includes('массив'))) {
              relevanceScore += 5; // Нормализовано с 4 до 5
            } else if (word.includes('металл') && (frameMaterial.includes('металл') || frameMaterial.includes('сталь'))) {
              relevanceScore += 5; // Нормализовано с 4 до 5
            }
          });
        }
        
        // 11. Поиск по нагрузке
        if (maxLoad && offer.params && offer.params['Максимальная нагрузка']) {
          const offerLoad = parseInt(offer.params['Максимальная нагрузка']);
          if (offerLoad >= maxLoad) {
            relevanceScore += 5; // Нормализовано с 4 до 5
          }
        }
        
        // 12. Поиск по жесткости
        if (offer.params && offer.params['Уровень жесткости']) {
          const stiffness = offer.params['Уровень жесткости'].toLowerCase();
          fullQueryWords.forEach(word => {
            if (word.includes('жесткий') && stiffness.includes('жесткий')) {
              relevanceScore += 5; // Нормализовано с 4 до 5
            } else if (word.includes('мягкий') && stiffness.includes('мягкий')) {
              relevanceScore += 5; // Нормализовано с 4 до 5
            }
          });
        }
        
        // 13. Обычный поиск по ключевым словам
        queryWords.forEach(word => {
          if (nameText.includes(word)) relevanceScore += 5; // Нормализовано с 3 до 5
          if (paramsText.includes(word)) relevanceScore += 2;
          if (descText.includes(word)) relevanceScore += 1;
        });
        
        // 14. Дополнительный поиск по полным словам - убираем (избыточно)
        
        // 15. НОВОЕ: Баллы за соответствие бюджету
        if (priceRange.maxPrice) {
          const pricePerUnit = getPricePerUnit(offer);
          const totalPrice = pricePerUnit * requestedQuantity;
          
          if (totalPrice <= priceRange.maxPrice) {
            relevanceScore += 5; // +5 баллов за соответствие бюджету
            console.log(`💰 ${offer.name}: в бюджете (${totalPrice} <= ${priceRange.maxPrice})`);
          }
        }
        
        return { ...offer, relevanceScore };
      }).filter(offer => offer.relevanceScore >= 5)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 50); // Ограничить топ-50 самых релевантных
        
  console.log(`🎯 После relevanceScore фильтра: ${filtered.length} товаров`);
  if (filtered.length > 0) {
    console.log('📊 Топ-5 по relevanceScore:', filtered.slice(0, 5).map(o => ({
      name: o.name,
      price: o.price,
      relevanceScore: o.relevanceScore
    })));
  }
    }
  }
  
  // Интеллектуальная сортировка и отбор товаров
  const priceIntent = detectPriceIntent(query);
  const requestedQuantity = extractQuantity(query);
  
  console.log(`🎯 Намерение: ${priceIntent}, количество: ${requestedQuantity}`);
  
  // Добавляем цену за единицу и общую стоимость к каждому товару
  filtered = filtered.map(offer => {
    const pricePerUnit = getPricePerUnit(offer);
    return {
      ...offer,
      pricePerUnit,
      totalPrice: pricePerUnit * requestedQuantity
    };
  });
  
  // Фильтр по бюджету убран - цена уже учтена в relevanceScore (+5 баллов)
  
  // Сортировка в зависимости от намерения
  if (priceIntent === 'cheapest') {
    // Только самый дешевый - сортируем по цене за единицу
    filtered.sort((a, b) => a.pricePerUnit - b.pricePerUnit);
    const finalResults = filtered.slice(0, 1); // Только 1 товар
    console.log(`📊 filterOffers RESULT (cheapest): найден 1 самый дешевый товар`);
    return finalResults;
  } else {
    // Разнообразие - сортируем по relevanceScore (приоритет релевантности)
    filtered.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    // Выбираем топ товары по релевантности (учитывая цвет, механизм и т.д.)
    const results = [];
    if (filtered.length >= 5) {
      // Берем топ-5 самых релевантных
      results.push(...filtered.slice(0, 5));
      console.log(`📊 filterOffers RESULT (variety): выбрано 5 самых релевантных товаров`);
    } else if (filtered.length >= 3) {
      // Берем топ-3 самых релевантных
      results.push(...filtered.slice(0, 3));
      console.log(`📊 filterOffers RESULT (variety): выбрано 3 самых релевантных товара`);
    } else {
      results.push(...filtered); // Если < 3, показываем все
      console.log(`📊 filterOffers RESULT (variety): показаны все ${filtered.length} товара`);
    }
    
    // Логируем финальные результаты
    console.log('📦 Выбранные товары:', results.map(o => ({
      name: o.name,
      price: o.price,
      pricePerUnit: o.pricePerUnit,
      totalPrice: o.totalPrice,
      category: o.category,
      relevanceScore: o.relevanceScore
    })));
    
    console.log(`📊 filterOffers END: возвращаем ${results.length} товаров из ${filtered.length} отфильтрованных`);
    return results;
  }
}

// Форматирование товаров для GPT
function formatOffersForGPT(offers, maxPrice = null) {
  return offers.map(offer => {
    let info = `- ${offer.name} — ${offer.price} ${offer.currency}`;
    
    // Добавляем цену за единицу если это комплект
    if (offer.pricePerUnit && offer.pricePerUnit !== offer.price) {
      info += ` (${offer.pricePerUnit.toFixed(0)} ${offer.currency} за шт)`;
    }
    
    // Добавляем информацию о превышении бюджета
    if (offer.aboveBudget && offer.totalPrice && maxPrice) {
      const excess = offer.totalPrice - maxPrice;
      info += ` (на ${excess.toFixed(0)} ${offer.currency} выше бюджета)`;
    }
    
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
      
      // Извлекаем priceRange для форматирования
      const priceRange = extractPriceRange(query || '');
      
      // Форматируем для GPT
      const formattedOffers = formatOffersForGPT(filteredOffers, priceRange.maxPrice);
      
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
      const metadata = await redis.get(CATALOG_METADATA_KEY);
      
      return res.status(200).json({
        success: true,
        totalOffers: catalog.totalCount,
        categories: catalog.categories,
        lastUpdate: catalog.timestamp,
        cacheInfo: {
          lastFetchTime: metadata?.timestamp ? new Date(metadata.timestamp).toISOString() : null,
          lastUpdateHour: metadata?.lastUpdate ? new Date(metadata.lastUpdate).getHours() : null
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

