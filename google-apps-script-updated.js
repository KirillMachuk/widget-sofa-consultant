function doPost(e) {
  try {
    var raw = e.postData && e.postData.contents ? e.postData.contents : '{}';
    var data = JSON.parse(raw);

    var SPREADSHEET_ID = '1wYQdnQ0gAMeWXnrKOS74UTsxjmE4z6QYRybI3TcC2TU';
    var SHEET_NAME = 'Лист1';

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

    // Обновленные заголовки с новыми полями
    var headers = ['Дата заявки', 'Телефон', 'Оффер', 'Сссылка на страницу', 'SessionID', 'Имя', 'Категория', 'Подарок', 'Мессенджер', 'Пожелания'];
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
    }

    var timestamp = data.timestamp || new Date().toISOString();
    var phone     = data.phone || '';
    var offer     = data.pretext || '';
    var pageUrl   = data.page_url || '';
    var sessionId = data.session_id || '';
    var name      = data.name || '';
    var category  = data.category || '';
    var gift      = data.gift || '';
    var messenger = data.messenger || '';
    var wishes    = data.wishes || '';

    // Добавляем строку с новыми полями
    sh.appendRow([timestamp, phone, offer, pageUrl, sessionId, name, category, gift, messenger, wishes]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Необязательно: чтобы GET по ссылке просто показывал OK
function doGet() {
  return ContentService.createTextOutput('OK');
}
