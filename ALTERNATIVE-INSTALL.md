# Альтернативные способы установки виджета в OpenCart

Если у вас нет доступа к файлам темы через FTP, используйте один из этих способов:

---

## Способ 1: Через модуль "Custom HTML" или "HTML Content"

### Шаг 1: Найдите модуль

1. Войдите в админ-панель OpenCart: `https://nm-shop.by/admin/`
2. Перейдите: **Extensions → Extensions**
3. Выберите тип расширения: **Modules**
4. Найдите один из модулей:
   - **Custom HTML**
   - **HTML Content**
   - **Custom Code**
   - **HTML Module**

### Шаг 2: Установите модуль (если еще не установлен)

1. Если модуль не найден, перейдите: **Extensions → Installer**
2. Загрузите модуль Custom HTML (если есть в вашем распоряжении)
3. Или используйте встроенные возможности OpenCart

### Шаг 3: Настройте модуль

1. В списке модулей найдите **Custom HTML** (или аналог)
2. Нажмите **Edit** (карандаш) или **Install** (если еще не установлен)
3. Настройки:
   - **Status**: Enabled (Включено)
   - **Position**: Header (или "Before </head>")
   - **Sort Order**: 1 (или минимальное значение)
4. В поле **HTML** или **Content** вставьте код из `CLIENT-INSTALL-CODE.txt`
5. Нажмите **Save**

### Шаг 4: Очистите кеш

- **Extensions → Modifications → Refresh**
- **Dashboard → Clear cache**

---

## Способ 2: Через встроенный редактор тем (OpenCart 3.x+)

### Если у вас есть доступ к Theme Editor:

1. Войдите в админ-панель
2. Перейдите: **Design → Theme Editor**
3. Выберите текущую тему
4. Найдите файл: `common/header.twig`
5. Найдите строку `</head>`
6. Вставьте код **перед** `</head>`
7. Нажмите **Save**
8. Очистите кеш

---

## Способ 3: Через Layout Editor (OpenCart 4.x)

1. Войдите в админ-панель
2. Перейдите: **Design → Layouts**
3. Выберите или создайте Layout для всех страниц
4. Добавьте модуль **HTML Content**
5. Вставьте код в поле модуля
6. Position: **Header**
7. Сохраните
8. Очистите кеш

---

## Способ 4: Через OCMOD (модификация OpenCart)

Если у вас есть доступ к созданию OCMOD модификаций:

1. Создайте файл `widget-install.ocmod.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<modification>
  <name>Chat Widget Installation</name>
  <code>widget_chat_install</code>
  <version>1.0</version>
  <author>nm-shop.by</author>
  <link></link>
  
  <file path="catalog/view/theme/*/template/common/header.twig">
    <operation>
      <search><![CDATA[</head>]]></search>
      <add position="before"><![CDATA[
<link rel="preconnect" href="https://widget-nine-murex.vercel.app" crossorigin>
<link rel="preconnect" href="https://api.openai.com" crossorigin>

<script>
(function() {
  if (window.nmShopWidgetLoaded) return;
  
  const TEST_PAGE_URL = '/kuhonnaya-mebel/kuhnya-variant-fasada-kvadro';
  const isTestPage = window.location.href.includes(TEST_PAGE_URL);
  
  if (!isTestPage) {
    console.log('[Widget] Not test page:', window.location.href);
    return;
  }
  
  console.log('[Widget] Loaded on test page');
  window.nmShopWidgetLoaded = true;
  
  const s = document.createElement('script');
  s.src = 'https://widget-nine-murex.vercel.app/widget.js?v=5.1.0';
  s.defer = true;
  s.async = true;
  s.dataset.api = 'https://widget-nine-murex.vercel.app/api/chat';
  s.dataset.prompt = 'https://widget-nine-murex.vercel.app/prompt.json';
  s.dataset.gas = 'https://script.google.com/macros/s/AKfycbxiJrvTNiGfXTbfFWMiTWEGAyh4RKFhoKU8zjIfmQqrZlphC_vdO4R_OS9zhd-gYoZJOw/exec';
  s.onerror = () => console.warn('[Widget] Failed to load widget.js');
  document.head.appendChild(s);
})();
</script>

<style>
.vfw-root { z-index: 9999999 !important; }
@media (max-width: 768px) {
  .vfw-root { bottom: 80px !important; }
}
.vfw-panel { z-index: 9999999 !important; }
</style>
      ]]></add>
    </operation>
  </file>
</modification>
```

2. Установите через: **Extensions → Installer → Upload**
3. Обновите модификации: **Extensions → Modifications → Refresh**
4. Очистите кеш

---

## Способ 5: Через плагин для кастомного кода

Если на сайте установлен плагин типа:
- **Code Injection**
- **Custom Scripts**
- **Header/Footer Code**

1. Найдите этот плагин в админке
2. Вставьте код в раздел "Header Code" или "Before </head>"
3. Сохраните
4. Очистите кеш

---

## Способ 6: Через файл footer.twig (если нет доступа к header)

Если нет доступа к `header.twig`, можно вставить в `footer.twig`:

1. Откройте: `catalog/view/theme/[ТЕМА]/template/common/footer.twig`
2. Найдите строку `</body>` или `</html>`
3. Вставьте код **перед** `</body>`
4. Очистите кеш

**Примечание:** Код будет работать, но preconnect ссылки лучше в `<head>`

---

## Какой способ выбрать?

| Способ | Когда использовать |
|--------|-------------------|
| **Custom HTML модуль** | ✅ Самый простой, если модуль есть |
| **Theme Editor** | ✅ Если есть доступ в админке |
| **Layout Editor** | ✅ Для OpenCart 4.x |
| **OCMOD** | ✅ Для автоматической установки |
| **FTP (header.twig)** | ✅ Самый надежный способ |

---

## Проверка установки

После любого способа:

1. Откройте тестовую страницу: https://nm-shop.by/kuhonnaya-mebel/kuhnya-variant-fasada-kvadro/
2. Откройте консоль браузера (F12 → Console)
3. Должно быть сообщение: `[Widget] Loaded on test page`
4. Виджет должен появиться в правом нижнем углу
5. На других страницах виджета быть не должно

---

## Если ничего не работает

1. Проверьте, что код вставлен правильно
2. Убедитесь, что кеш очищен
3. Проверьте консоль браузера на ошибки
4. Попробуйте другой способ установки

---

**Рекомендация:** Начните с **Способа 1 (Custom HTML модуль)** - это самый простой вариант без доступа к FTP.

