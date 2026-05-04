const cheerio = require('cheerio');

const SITES = [
  {
    group: '乃木坂46',
    url: (date) => `https://www.nogizaka46.com/s/n46/media/list?dy=${date}`,
  },
  {
    group: '櫻坂46',
    url: (date) => `https://sakurazaka46.com/s/s46/media/list?dy=${date}`,
  },
  {
    group: '日向坂46',
    url: (date) => `https://www.hinatazaka46.com/s/official/media/list?dy=${date}`,
  },
];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'ja,en;q=0.5',
};

const CHECK_CLASSES = [
  'p-schedule__item',
  'c-schedule__date--list',
  'c-schedule__category',
  'c-schedule__time--list',
  'c-schedule__text',
];

module.exports = async (req, res) => {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowJST.toISOString().slice(0, 10).replace(/-/g, '');
  const dateStr = (req.query.date || todayStr).replace(/\D/g, '');

  const results = await Promise.all(
    SITES.map(async (site) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(site.url(dateStr), {
          headers: FETCH_HEADERS,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const html = await response.text();
        const $ = cheerio.load(html);

        const classFound = {};
        for (const cls of CHECK_CLASSES) {
          classFound[cls] = $(`.${cls}`).length;
        }

        // 実際に存在するスケジュール系クラスをサンプリング
        const scheduleClasses = new Set();
        $('[class]').each((_, el) => {
          const classes = ($(el).attr('class') || '').split(/\s+/);
          classes.forEach(c => {
            if (c.includes('schedule') || c.includes('Schedule')) {
              scheduleClasses.add(c);
            }
          });
        });

        return {
          group: site.group,
          url: site.url(dateStr),
          status: response.status,
          ok: response.ok,
          htmlLength: html.length,
          classFound,
          scheduleClasses: [...scheduleClasses].sort(),
        };
      } catch (err) {
        clearTimeout(timer);
        return {
          group: site.group,
          url: site.url(dateStr),
          status: null,
          ok: false,
          error: err.message,
          classFound: {},
          scheduleClasses: [],
        };
      }
    })
  );

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ date: dateStr, results });
};
