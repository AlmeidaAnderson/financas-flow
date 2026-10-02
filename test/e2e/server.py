"""Static server for site/ + a tiny shared fake backend for the test-only stub store (/__stub/*).
Usage: python3 test/e2e/server.py [port]   (or import and call start(port) from the e2e script)."""
import http.server, json, os, sys, threading, datetime, urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SITE = os.path.join(ROOT, 'site')
STATE = {}
LOCK = threading.Lock()


def ns_state(ns):
    if ns not in STATE:
        STATE[ns] = {'seq': 0, 'meta': {}, 'months': {}}
    return STATE[ns]


def now_iso():
    return datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def merge_month(cur, incoming):
    """incoming = the client's full live list for the month; rows it no longer has become tombstones."""
    by = {r['id']: r for r in cur if isinstance(r, dict) and 'id' in r}
    seen = set()
    for r in incoming:
        if not isinstance(r, dict) or 'id' not in r:
            continue
        seen.add(r['id'])
        ex = by.get(r['id'])
        if ex is None or str(r.get('updatedAt') or '') >= str(ex.get('updatedAt') or ''):
            by[r['id']] = r
    stamp = now_iso()
    for i, r in list(by.items()):
        if i not in seen and not r.get('deleted'):
            by[i] = {'id': i, 'deleted': True, 'updatedAt': stamp}
    return list(by.values())


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                      '.webmanifest': 'application/manifest+json', '.json': 'application/json'}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITE, **k)

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('cache-control', 'no-store')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__stub/'):
            ns = urllib.parse.parse_qs(u.query).get('ns', ['default'])[0]
            with LOCK:
                return self._json(ns_state(ns))
        if u.path.startswith('/.netlify/'):
            return self._json({'error': 'no identity here'}, 404)
        return super().do_GET()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith('/__stub/'):
            return self._json({'error': 'nope'}, 404)
        ns = urllib.parse.parse_qs(u.query).get('ns', ['default'])[0]
        n = int(self.headers.get('content-length') or 0)
        data = json.loads(self.rfile.read(n) or b'null')
        parts = u.path.split('/')[2:]
        with LOCK:
            st = ns_state(ns)
            if parts[0] == 'meta':
                st['meta'][parts[1]] = data
            elif parts[0] == 'month':
                st['months'][parts[1]] = merge_month(st['months'].get(parts[1], []), data or [])
            elif parts[0] == 'reset':
                STATE[ns] = {'seq': 0, 'meta': {}, 'months': {}}
                return self._json({'ok': True})
            st['seq'] += 1
            return self._json({'seq': st['seq'], 'state': st})


def start(port=8766):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), H)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


if __name__ == '__main__':
    p = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print('serving', SITE, 'on', p)
    http.server.ThreadingHTTPServer(('127.0.0.1', p), H).serve_forever()
