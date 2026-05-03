const cheerio = require('cheerio');

const SITES = [
  {
    group: '乃木坂46',
    url: (date) => `https://www.nogizaka46.com/s/n46/media/list?dy=${date}`,
    baseUrl: 'https://www.nogizaka46.com',
  },
  {
    group: '櫻坂46',
    url: (date) => `https://sakurazaka46.com/s/s46/media/list?dy=${date}`,
    baseUrl: 'https://sakurazaka46.com',
  },
  {
    group: '日向坂46',
    url: (date) => `https://www.hinatazaka46.com/s/official/media/list?dy=${date}`,
    baseUrl: 'https://www.hinatazaka46.com',
  },
];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'ja,en;q=0.5',
};

function parseSchedule(html, group, baseUrl, year, month, targetDay) {
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
        group,
        date: `${year}-${String(month).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
        time,
        category,
        title,
        url: href ? baseUrl + href : '',
        members: [],
      });
    }
  });

  return items;
}

async function fetchSite(site, dateStr, year, month, targetDay) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(site.url(dateStr), {
      headers: FETCH_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseSchedule(html, site.group, site.baseUrl, year, month, targetDay);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

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

  const allResults = await Promise.all(
    SITES.map(site => fetchSite(site, dateStr, year, month, day))
  );
  const flat = allResults.flat();

  flat.sort((a, b) => {
    const ta = a.time || '99:99';
    const tb = b.time || '99:99';
    return ta < tb ? -1 : ta > tb ? 1 : a.group.localeCompare(b.group);
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(flat);
};
