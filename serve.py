#!/usr/bin/env python3
"""Local dev server for mint-kids.

Serves docs/ (the same tree GitHub Pages publishes) with caching disabled —
Tizen's WebView will otherwise keep showing a stale build and never even hit
the server. See also the frozen bootstrap in docs/index.html.
"""
import functools, http.server, socketserver, sys, os

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stderr.flush()

if __name__ == '__main__':
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'docs')
    handler = functools.partial(NoCacheHandler, directory=root)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('0.0.0.0', 8080), handler) as httpd:
        print('serving %s on 0.0.0.0:8080 (no-cache)' % root, flush=True)
        httpd.serve_forever()
