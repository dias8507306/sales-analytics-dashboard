// Общая проверка пароля для функций сайта (файлы с «_» Vercel не публикует как отдельные адреса).
module.exports.passwordOk = (req) => {
  const password = process.env.DASHBOARD_PASSWORD;
  return !password || req.headers['x-dashboard-password'] === password;
};
