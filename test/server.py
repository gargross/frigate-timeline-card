"""Test server for the harness: static files, plus the Frigate VOD proxy paths
(/api/frigate/<id>/vod/<camera>/start/<s>/end/<e>/<file>) mapped onto test/media/.
EVIL=1 serves a manifest whose segments point at another origin (security test)."""
import http.server, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, 'test', 'media')
VOD = re.compile(r'^/api/frigate/[^/]+/vod/[^/]+/start/\d+/end/\d+/([\w.-]+)$')
EVIL = os.environ.get('EVIL') == '1'

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        m = VOD.match(path)
        if m:
            name = m.group(1)
            if name == 'index.m3u8' and EVIL:
                name = 'evil.m3u8'
            f = os.path.join(MEDIA, name)
            if os.path.isfile(f):
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.apple.mpegurl' if name.endswith('.m3u8') else 'video/mp4')
                self.end_headers()
                with open(f, 'rb') as fh:
                    self.wfile.write(fh.read())
                return
            self.send_error(404)
            return
        super().do_GET()

    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
