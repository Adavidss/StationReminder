#!/usr/bin/env python3
"""Static dev server with caching disabled (python -m http.server sends no
Cache-Control, so browsers heuristically cache and serve stale files mid-edit)."""
import http.server
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # quiet


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler) as srv:
        print(f"Serving {ROOT} on http://127.0.0.1:{PORT} (no-store)")
        srv.serve_forever()
