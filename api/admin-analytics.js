// API для получения аналитики в админ-панели
const redisClient = require('../utils/redis-client');

module.exports = async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Получаем параметр source из query string
    const url = new URL(req.url, `http://${req.headers.host}`);
    const source = url.searchParams.get('source') || 'test';
    
    // Получаем значения счетчиков из Redis для указанного источника
    const [pageViews, widgetOpens, formSubmits, uniqueVisitorsCount, formInvocations, chatPhoneLeads] = await Promise.all([
      redisClient.get(`analytics:page_view:${source}`).catch(() => 0),
      redisClient.get(`analytics:widget_open:${source}`).catch(() => 0),
      redisClient.get(`analytics:form_submit:${source}`).catch(() => 0),
      redisClient.scard(`unique_visitors:${source}`).catch(() => 0), // Количество уникальных посетителей
      redisClient.get(`analytics:form_invocation:${source}`).catch(() => 0),
      redisClient.get(`analytics:chat_phone_lead:${source}`).catch(() => 0) // Лиды из чата
    ]);
    
    // Преобразуем в числа
    const pageViewsCount = parseInt(pageViews || 0, 10);
    const widgetOpensCount = parseInt(widgetOpens || 0, 10);
    const formSubmitsCount = parseInt(formSubmits || 0, 10);
    const uniqueVisitors = parseInt(uniqueVisitorsCount || 0, 10);
    const formInvocationsCount = parseInt(formInvocations || 0, 10);
    const chatPhoneLeadsCount = parseInt(chatPhoneLeads || 0, 10);
    
    // Суммируем лиды: заполненные формы + лиды из чата
    const totalLeads = formSubmitsCount + chatPhoneLeadsCount;
    
    // Вычисляем конверсии
    const conversionWidgetOpen = pageViewsCount > 0 
      ? parseFloat(((widgetOpensCount / pageViewsCount) * 100).toFixed(2))
      : 0;
    
    const conversionFormSubmit = widgetOpensCount > 0
      ? parseFloat(((totalLeads / widgetOpensCount) * 100).toFixed(2))
      : 0;
    
    return res.status(200).json({
      success: true,
      source: source,
      analytics: {
        uniqueVisitors: uniqueVisitors,
        pageViews: pageViewsCount,
        widgetOpens: widgetOpensCount,
        totalLeads: totalLeads, // Общее количество лидов (формы + чат)
        formSubmits: formSubmitsCount, // Только заполненные формы (для отладки)
        chatPhoneLeads: chatPhoneLeadsCount, // Только лиды из чата (для отладки)
        formInvocations: formInvocationsCount,
        conversionWidgetOpen: conversionWidgetOpen,
        conversionFormSubmit: conversionFormSubmit
      }
    });
    
  } catch (error) {
    console.error('Ошибка получения аналитики:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка получения аналитики',
      error: error.message 
    });
  }
};

