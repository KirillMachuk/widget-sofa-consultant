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
    // Получаем значения счетчиков из Redis
    const [pageViews, widgetOpens, formSubmits] = await Promise.all([
      redisClient.get('analytics:page_view').catch(() => 0),
      redisClient.get('analytics:widget_open').catch(() => 0),
      redisClient.get('analytics:form_submit').catch(() => 0)
    ]);
    
    // Преобразуем в числа
    const pageViewsCount = parseInt(pageViews || 0, 10);
    const widgetOpensCount = parseInt(widgetOpens || 0, 10);
    const formSubmitsCount = parseInt(formSubmits || 0, 10);
    
    // Вычисляем конверсии
    const conversionWidgetOpen = pageViewsCount > 0 
      ? parseFloat(((widgetOpensCount / pageViewsCount) * 100).toFixed(2))
      : 0;
    
    const conversionFormSubmit = widgetOpensCount > 0
      ? parseFloat(((formSubmitsCount / widgetOpensCount) * 100).toFixed(2))
      : 0;
    
    return res.status(200).json({
      success: true,
      analytics: {
        pageViews: pageViewsCount,
        widgetOpens: widgetOpensCount,
        formSubmits: formSubmitsCount,
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

