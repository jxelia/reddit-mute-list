# Local server for the popup design editor: serves the project folder and
# saves the editor's changes to tools/designer/changes.json for Claude to apply.
#   python3 tools/designer/serve.py   →   http://127.0.0.1:8790/
import glob, http.server, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CHANGES = os.path.join(HERE, 'changes.json')
WATCH = ['manage/*', 'storage.js', 'presets/*.js']


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':
            self.send_response(302)
            self.send_header('Location', '/tools/designer/')
            self.end_headers()
        elif path == '/tools/designer/stamp':
            # Newest change to the popup's files, so the editor reloads the frame.
            files = [f for pat in WATCH for f in glob.glob(os.path.join(ROOT, pat))]
            self.send_json(max(os.path.getmtime(f) for f in files))
        elif path == '/tools/designer/backup.json':
            # The newest popup backup in the project folder, as sample data.
            backups = sorted(glob.glob(os.path.join(ROOT, 'reddit-mute-list-*.json')))
            if not backups:
                return self.send_error(404)
            with open(backups[-1]) as f:
                self.send_json(json.load(f))
        elif path == '/tools/designer/changes.json' and not os.path.exists(CHANGES):
            self.send_json({})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path != '/tools/designer/save':
            return self.send_error(404)
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with open(CHANGES, 'w') as f:
            json.dump(data, f, indent=2)
        self.send_json({'ok': True})

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('PORT', 8790))), Handler).serve_forever()
