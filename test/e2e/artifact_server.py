"""TEST-ONLY server for the Artifact build e2e (test/e2e/e2e_artifact.py).

  GET  /                       dist-artifact/financas-flow.html wrapped in a minimal skeleton
                               (doctype + head with charset/viewport + body), as the claude.ai platform does
  GET  /__fakedb/doc?ns&path   {exists, data, version}
  GET  /__fakedb/list?ns&coll  [{id, path, data, version}]  (direct children only)
  GET  /__fakedb/changes?ns&since=N   {seq, changes:[{path, data|null}]}   (since=-1 → only the current seq)
  POST /__fakedb/set?ns  {path, data}     POST /__fakedb/delete?ns  {path}
The fake db is the shared backend of test/fake-claude.js (createHttpBackend): pages = devices of one account."""
import http.server, json, os, threading, urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIST = os.path.join(ROOT, 'dist-artifact', 'financas-flow.html')
STATE = {}
LOCK = threading.Lock()
SKELETON = ('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>\n{}\n</body></html>')


def ns_state(ns):
    if ns not in STATE:
        STATE[ns] = {'seq': 0, 'docs': {}, 'log': []}
    return STATE[ns]


def parent(path):
    return '/'.join(path.split('/')[:-1])


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, ctype, code=200):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('content-type', ctype)
        self.send_header('cache-control', 'no-store')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(json.dumps(obj), 'application/json', code)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        ns = qs.get('ns', ['default'])[0]
        if u.path in ('/', '/index.html'):
            with open(DIST, encoding='utf-8') as f:
                return self._send(SKELETON.format(f.read()), 'text/html; charset=utf-8')
        with LOCK:
            st = ns_state(ns)
            if u.path == '/__fakedb/doc':
                p = qs['path'][0]
                d = st['docs'].get(p)
                return self._json({'exists': True, 'data': d['data'], 'version': d['version']} if d else {'exists': False})
            if u.path == '/__fakedb/list':
                c = qs['coll'][0]
                return self._json([{'id': p.split('/')[-1], 'path': p, 'data': d['data'], 'version': d['version']}
                                   for p, d in sorted(st['docs'].items()) if parent(p) == c])
            if u.path == '/__fakedb/changes':
                since = int(qs.get('since', ['0'])[0])
                if since < 0:
                    return self._json({'seq': st['seq'], 'changes': []})
                return self._json({'seq': st['seq'], 'changes': [{'path': p, 'data': d} for s, p, d in st['log'] if s > since]})
        return self._send('not found', 'text/plain', 404)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        ns = urllib.parse.parse_qs(u.query).get('ns', ['default'])[0]
        n = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(n) or b'null')
        with LOCK:
            st = ns_state(ns)
            if u.path == '/__fakedb/set':
                st['seq'] += 1
                st['docs'][body['path']] = {'data': body['data'], 'version': st['seq']}
                st['log'].append((st['seq'], body['path'], body['data']))
                return self._json({'ok': True, 'seq': st['seq']})
            if u.path == '/__fakedb/delete':
                if body['path'] in st['docs']:
                    st['seq'] += 1
                    del st['docs'][body['path']]
                    st['log'].append((st['seq'], body['path'], None))
                return self._json({'ok': True, 'seq': st['seq']})
        return self._json({'error': 'nope'}, 404)



class QuietServer(http.server.ThreadingHTTPServer):
    """The browser aborts in-flight requests when a page is closed, reloaded or navigated (a poll, the 650 KB page):
    the write then fails with BrokenPipe/ConnectionReset and the stock handle_error prints a traceback. Not a failure."""
    daemon_threads = True

    def handle_error(self, request, client_address):
        import sys as _sys
        if isinstance(_sys.exc_info()[1], (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)


def start(port):
    srv = QuietServer(('127.0.0.1', port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def docs(ns):
    with LOCK:
        return json.loads(json.dumps(ns_state(ns)['docs']))
