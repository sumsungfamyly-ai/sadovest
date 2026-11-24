import { getJ, setJ } from './db.js';

// Новости хранятся одним списком в Redis (ключ news:list). Добавляются и правятся из админ-панели приложения.
const KEY = 'news:list';
const sortNews = a => a.sort((x, y) => (y.pin ? 1 : 0) - (x.pin ? 1 : 0) || y.created - x.created);

export async function listNews() {
  const a = await getJ(KEY);
  return sortNews(Array.isArray(a) ? a : []);
}
export const saveNews = list => setJ(KEY, list);
