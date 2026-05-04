const cheerio = require('cheerio');

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'ja,en;q=0.5',
};

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    return { status: res.status, ok: res.ok, body: await res.text() };
  } catch (err) {
    clearTimeout(timer);
    return { status: null, ok: false, body: null, error: err.message };
  }
}

module.exports = async (req, res) => {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowJST.toISOString().slice(0, 10).replace(/-/g, '');
  const dateStr = (req.query.date || todayStr).replace(/\D/g, '');
  const monthStr = dateStr.slice(0, 6); // YYYYMM

  // ── 乃木坂46 API テスト ──────────────────────────────────────
  const nogiApiBase = 'https://www.nogizaka46.com/s/n46/api/list/schedule';
  const [nogiDay, nogiMonth, nogiRaw] = await Promise.all([
    fetchText(`${nogiApiBase}?dy=${dateStr}`),
    fetchText(`${nogiApiBase}?dy=${monthStr}`),
    fetchText(`${nogiApiBase}`),
  ]);

  // ── 櫻坂46 HTML パースのテスト ──────────────────────────────
  const sakuraPage = await fetchText(`https://sakurazaka46.com/s/s46/media/list?dy=${dateStr}`);
  let sakuraItems = [];
  if (sakuraPage.ok && sakuraPage.body) {
    const $ = cheerio.load(sakuraPage.body);
    const targetDate = `${dateStr.slice(0,4)}.${dateStr.slice(4,6)}.${dateStr.slice(6,8)}`;
    $('.js-schedule-detail').each((_, el) => {
      const dateText = $(el).find('.date').text().trim().replace(/\s/g, '');
      const type     = $(el).find('.type').text().trim();
      const title    = $(el).find('h2.title, .title').first().text().trim();
      const href     = $(el).find('a[href]').attr('href') || '';
      sakuraItems.push({ dateText, targetDate, match: dateText.startsWith(targetDate), type, title, href: href.slice(0, 80) });
    });
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    date: dateStr,
    nogi: {
      'api?dy=YYYYMMDD': { status: nogiDay.status, bodySlice: nogiDay.body?.slice(0, 300) },
      'api?dy=YYYYMM':   { status: nogiMonth.status, bodySlice: nogiMonth.body?.slice(0, 300) },
      'api(no param)':   { status: nogiRaw.status, bodySlice: nogiRaw.body?.slice(0, 300) },
    },
    sakura: {
      itemCount: sakuraItems.length,
      targetDate: `${dateStr.slice(0,4)}.${dateStr.slice(4,6)}.${dateStr.slice(6,8)}`,
      items: sakuraItems.slice(0, 5),
    },
  });
};
