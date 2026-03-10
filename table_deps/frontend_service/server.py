"""Lightweight stdlib HTTP server for the table-deps frontend."""

import json
import mimetypes
import socketserver
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

_STATIC_DIR = Path(__file__).parent / "static"
_TEMPLATES_DIR = Path(__file__).parent / "templates"

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")


class _Handler(BaseHTTPRequestHandler):
    project_data: dict | None = None
    project_name: str = ""

    def log_message(self, fmt, *args):
        pass  # suppress access logs

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/visualizer"):
            self._serve_template("visualizer.html")
        elif path == "/project":
            self._serve_template("project.html")
        elif path == "/api/scan":
            self._serve_scan()
        elif path.startswith("/static/"):
            self._serve_static(path[len("/static/"):])
        else:
            self._respond(404, "text/plain", b"Not found")

    def _serve_template(self, name: str):
        tpl = _TEMPLATES_DIR / name
        if not tpl.exists():
            self._respond(404, "text/plain", b"Template not found")
            return
        self._respond(200, "text/html; charset=utf-8", tpl.read_bytes())

    def _serve_static(self, rel: str):
        try:
            target = (_STATIC_DIR / rel).resolve()
            target.relative_to(_STATIC_DIR.resolve())
        except ValueError:
            self._respond(403, "text/plain", b"Forbidden")
            return
        if not target.is_file():
            self._respond(404, "text/plain", b"Not found")
            return
        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self._respond(200, mime, target.read_bytes())

    def _serve_scan(self):
        data = self.__class__.project_data
        if data is None:
            body = json.dumps({"error": "No project loaded"}).encode()
            self._respond(404, "application/json", body)
            return
        self._respond(200, "application/json; charset=utf-8", json.dumps(data).encode())

    def _respond(self, status: int, content_type: str, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


def start_server(
    port: int = 7654,
    *,
    project_data: dict | None = None,
    project_name: str = "",
    open_path: str = "/",
) -> None:
    """Start the HTTP server, open the browser, and block until Ctrl-C."""
    _Handler.project_data = project_data
    _Handler.project_name = project_name

    httpd = None
    for try_port in [port, 0]:
        try:
            httpd = socketserver.TCPServer(("127.0.0.1", try_port), _Handler)
            httpd.allow_reuse_address = True
            break
        except OSError:
            if try_port == 0:
                raise

    actual_port = httpd.server_address[1]
    url = f"http://127.0.0.1:{actual_port}{open_path}"
    print(f"table-deps UI  ->  {url}  (Ctrl-C to stop)")

    def _open():
        time.sleep(0.15)
        webbrowser.open(url)

    threading.Thread(target=_open, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()
