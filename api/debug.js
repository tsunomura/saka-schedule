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

function extractScheduleHints($) {
  // スケジュール系クラスを持つ要素のouterHTMLサンプル（最大3件・各500文字）
  const snippets = [];
  $('[class]').each((_, el) => {
    if (snippets.length >= 3) return false;
    const cls = $(el).attr('class') || '';
    if (cls.includes('schedule') || cls.includes('Schedule')) {
      const outer = $.html(el).slice(0, 500);
      snippets.push({ class: cls, html: outer });
    }
  });

  // scriptタグからAPI URLっぽい文字列を抽出
  const apiUrls = new Set();
  $('script').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src) return;
    const text = $(el).html() || '';
    const matches = text.match(/["'`](\/[^"'`\s]*(?:schedule|api)[^"'`\s]*)["'`]/gi) || [];
    matches.slice(0, 10).forEach(m => apiUrls.add(m.replace(/["'`]/g, '')));
  });

  // data-属性からAPI/URLヒントを抽出
  const dataAttrs = [];
  $('[class*="schedule"], [class*="Schedule"]').each((_, el) => {
    const attrs = el.attribs || {};
    const relevant = Object.entries(attrs).filter(([k]) => k.startsWith('data-'));
    if (relevant.length) dataAttrs.push({ class: attrs.class, data: Object.fromEntries(relevant) });
  });

  // scriptタグのsrc一覧（jsファイル）
  const scriptSrcs = [];
  $('script[src]').each((_, el) => {
    scriptSrcs.push($(el).attr('src'));
  });

  return { snippets, apiUrls: [...apiUrls], dataAttrs: dataAttrs.slice(0, 5), scriptSrcs: scriptSrcs.slice(0, 10) };
}

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

        const scheduleClasses = new Set();
        $('[class]').each((_, el) => {
          ($(el).attr('class') || '').split(/\s+/).forEach(c => {
            if (c.includes('schedule') || c.includes('Schedule')) scheduleClasses.add(c);
          });
        });

        const hints = extractScheduleHints($);

        return {
          group: site.group,
          status: response.status,
          htmlLength: html.length,
          scheduleClasses: [...scheduleClasses].sort(),
          ...hints,
        };
      } catch (err) {
        clearTimeout(timer);
        return {
          group: site.group,
          status: null,
          error: err.message,
        };
      }
    })
  );

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ date: dateStr, results });
};
