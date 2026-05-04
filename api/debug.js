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

function parseJsonp(body) {
  // res({...}) or callback({...}) → parse inner JSON
  const start = body.indexOf('(');
  const end   = body.lastIndexOf(')');
  if (start === -1 || end <= start) throw new Error(`no parens found, body starts: ${body.slice(0, 80)}`);
  return JSON.parse(body.slice(start + 1, end));
}

module.exports = async (req, res) => {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowJST.toISOString().slice(0, 10).replace(/-/g, '');
  const dateStr = (req.query.date || todayStr).replace(/\D/g, '');

  // ── 乃木坂46 API ──────────────────────────────────────────────
  const nogiRes = await fetchText(`https://www.nogizaka46.com/s/n46/api/list/schedule?dy=${dateStr}`);
  let nogiResult = { status: nogiRes.status, rawBodyStart: nogiRes.body?.slice(0, 400) };
  if (nogiRes.ok && nogiRes.body) {
    try {
      const parsed = parseJsonp(nogiRes.body);
      const first  = parsed.data?.[0] ?? null;
      nogiResult = {
        ...nogiResult,
        count: parsed.count,
        firstItemKeys: first ? Object.keys(first) : [],
        firstItem: first,
      };
    } catch (e) {
      nogiResult.parseError = e.message;
    }
  }

  // ── 櫻坂46 ────────────────────────────────────────────────────
  const targetDate = `${dateStr.slice(0,4)}.${dateStr.slice(4,6)}.${dateStr.slice(6,8)}`;
  const sakuraRes = await fetchText(`https://sakurazaka46.com/s/s46/media/list?dy=${dateStr}`);
  const sakuraItems = [];
  if (sakuraRes.ok && sakuraRes.body) {
    const $ = cheerio.load(sakuraRes.body);
    $('.js-schedule-detail').each((_, el) => {
      const rawDate  = $(el).find('.date').text().replace(/[\s ]+/g, '');
      if (rawDate.slice(0, 10) !== targetDate) return;
      const time     = rawDate.slice(10).replace(/～$/, '');
      const category = $(el).find('.type').text().trim();
      const title    = $(el).find('h2.title, .title').first().text().trim();
      const href     = $(el).find('.lead a').attr('href') || $(el).find('a[href]').attr('href') || '';
      const url      = href.startsWith('http') ? href : href ? 'https://sakurazaka46.com' + href : '';
      sakuraItems.push({ time, category, title, url });
    });
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ date: dateStr, nogi: nogiResult, sakura: { targetDate, count: sakuraItems.length, items: sakuraItems } });
};
