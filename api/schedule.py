from http.server import BaseHTTPRequestHandler
from bs4 import BeautifulSoup, Tag
import json
import requests
import urllib.parse
import concurrent.futures
from datetime import datetime, timezone, timedelta

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept-Language': 'ja,en;q=0.5',
}

SITES = [
    {
        'group': '乃木坂46',
        'url': 'https://www.nogizaka46.com/s/n46/media/list?dy={date}',
        'base_url': 'https://www.nogizaka46.com',
    },
    {
        'group': '櫻坂46',
        'url': 'https://sakurazaka46.com/s/s46/media/list?dy={date}',
        'base_url': 'https://sakurazaka46.com',
    },
    {
        'group': '日向坂46',
        'url': 'https://www.hinatazaka46.com/s/official/media/list?dy={date}',
        'base_url': 'https://www.hinatazaka46.com',
    },
]


def parse_schedule(html, group, base_url, year, month, target_day):
    soup = BeautifulSoup(html, 'html.parser')
    items = []
    current_day = None

    for element in soup.find_all(True):
        if not isinstance(element, Tag):
            continue
        classes = element.get('class', [])

        if 'c-schedule__date--list' in classes:
            span = element.find('span')
            if span:
                try:
                    current_day = int(span.get_text(strip=True))
                except ValueError:
                    pass

        elif element.name == 'li' and 'p-schedule__item' in classes:
            if current_day != target_day:
                continue

            cat_el = element.find(class_='c-schedule__category')
            time_el = element.find(class_='c-schedule__time--list')
            title_el = element.find(class_='c-schedule__text')
            link_el = element.find('a', href=True)

            items.append({
                'group': group,
                'date': f'{year:04d}-{month:02d}-{target_day:02d}',
                'time': time_el.get_text(strip=True) if time_el else '',
                'category': cat_el.get_text(strip=True) if cat_el else '',
                'title': title_el.get_text(strip=True) if title_el else '',
                'url': base_url + link_el['href'] if link_el else '',
                'members': [],
            })

    return items


def fetch_site(site, date_str, year, month, target_day):
    try:
        url = site['url'].format(date=date_str)
        r = requests.get(url, headers=HEADERS, timeout=8)
        r.raise_for_status()
        r.encoding = 'utf-8'
        return parse_schedule(r.text, site['group'], site['base_url'], year, month, target_day)
    except Exception:
        return []


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        jst = timezone(timedelta(hours=9))
        today = datetime.now(jst)
        date_str = qs.get('date', [today.strftime('%Y%m%d')])[0]

        try:
            dt = datetime.strptime(date_str, '%Y%m%d')
        except ValueError:
            dt = today

        y, m, d = dt.year, dt.month, dt.day

        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
            futs = [ex.submit(fetch_site, s, date_str, y, m, d) for s in SITES]
            for f in concurrent.futures.as_completed(futs):
                results.extend(f.result())

        results.sort(key=lambda x: (x['time'] or '99:99', x['group']))

        body = json.dumps(results, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
