const cheerio = require('cheerio');

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'ja,en;q=0.5',
};

// ── 日向坂46（HTMLスクレイピング） ──────────────────────────────

function parseHinatazaka(html, year, month, targetDay) {
  const $ = cheerio.load(html);
  const items = [];
  let currentDay = null;

  $('*').each((_, el) => {
    const classes = ($(el).attr('class') || '').split(/\s+/);

    if (classes.includes('c-schedule__date--list')) {
      const day = parseInt($(el).find('span').first().text().trim(), 10);
      if (!isNaN(day)) currentDay = day;
      return;
    }

    if (el.tagName === 'li' && classes.includes('p-schedule__item')) {
      if (currentDay !== targetDay) return;

      const category = $(el).find('.c-schedule__category').text().trim();
      const time     = $(el).find('.c-schedule__time--list').text().trim();
      const title    = $(el).find('.c-schedule__text').text().trim();
      const href     = $(el).find('a').attr('href') || '';

      items.push({
        group: '日向坂46',
        date: `${year}-${String(month).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
        time, category, title,
        url: href ? 'https://www.hinatazaka46.com' + href : '',
        members: [],
      });
    }
  });

  return items;
}

// ── 櫻坂46（HTMLスクレイピング） ────────────────────────────────

function parseSakurazaka(html, year, month, targetDay) {
  const $ = cheerio.load(html);
  const items = [];
  const targetDate = `${year}.${String(month).padStart(2, '0')}.${String(targetDay).padStart(2, '0')}`;

  $('.js-schedule-detail').each((_, el) => {
    // .date の text は "2026.05.04" または "2026.05.0418:30～" の形式
    const rawDate = $(el).find('.date').text().replace(/[\s ]+/g, '');
    if (rawDate.slice(0, 10) !== targetDate) return;

    const time     = rawDate.slice(10).replace(/～$/, '');
    const category = $(el).find('.type').text().trim();
    const title    = $(el).find('h2.title, .title').first().text().trim();
    const href     = $(el).find('.lead a').attr('href') || $(el).find('a[href]').attr('href') || '';
    const url      = href.startsWith('http') ? href : href ? 'https://sakurazaka46.com' + href : '';

    items.push({
      group: '櫻坂46',
      date: `${year}-${String(month).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
      time, category, title, url, members: [],
    });
  });

  return items;
}

// ── 乃木坂46（JSON API） ─────────────────────────────────────────

function parseJsonp(body) {
  const start = body.indexOf('(');
  const end   = body.lastIndexOf(')');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start + 1, end));
  } catch {
    return null;
  }
}

function parseNogizaka(body, year, month, targetDay) {
  const parsed = parseJsonp(body);
  if (!parsed?.data) return [];

  return parsed.data.map(item => {
    // text フィールドは HTML。最初の <a href> からURLを抽出
    const $t = cheerio.load(item.text || '');
    const href = $t('a[href]').first().attr('href') || '';
    const url  = href.startsWith('http') ? href
               : href ? 'https://www.nogizaka46.com' + href
               : '';

    return {
      group: '乃木坂46',
      date: `${year}-${String(month).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
      time:     item.start_time || item.time || '',
      category: item.category_name || item.category || '',
      title:    item.title || '',
      url,
      members:  [],
    };
  });
}

// ── 共通フェッチ ────────────────────────────────────────────────

async function fetchSite(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── エントリーポイント ───────────────────────────────────────────

module.exports = async (req, res) => {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowJST.toISOString().slice(0, 10).replace(/-/g, '');
  const dateStr = (req.query.date || todayStr).replace(/\D/g, '');

  let year, month, day;
  if (/^\d{8}$/.test(dateStr)) {
    year  = parseInt(dateStr.slice(0, 4), 10);
    month = parseInt(dateStr.slice(4, 6), 10);
    day   = parseInt(dateStr.slice(6, 8), 10);
  } else {
    year  = nowJST.getUTCFullYear();
    month = nowJST.getUTCMonth() + 1;
    day   = nowJST.getUTCDate();
  }

  const [nogiBody, sakuraBody, hinataBody] = await Promise.all([
    fetchSite(`https://www.nogizaka46.com/s/n46/api/list/schedule?dy=${dateStr}`),
    fetchSite(`https://sakurazaka46.com/s/s46/media/list?dy=${dateStr}`),
    fetchSite(`https://www.hinatazaka46.com/s/official/media/list?dy=${dateStr}`),
  ]);

  const items = [
    ...(nogiBody   ? parseNogizaka(nogiBody,   year, month, day) : []),
    ...(sakuraBody ? parseSakurazaka(sakuraBody, year, month, day) : []),
    ...(hinataBody ? parseHinatazaka(hinataBody, year, month, day) : []),
  ];

  items.sort((a, b) => {
    const ta = a.time || '99:99';
    const tb = b.time || '99:99';
    return ta < tb ? -1 : ta > tb ? 1 : a.group.localeCompare(b.group);
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(items);
};
