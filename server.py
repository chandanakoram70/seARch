import http.server
import socketserver
import os

HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", 80))

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

with socketserver.TCPServer((HOST, PORT), CORSRequestHandler) as httpd:
    print(f"Serving at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    httpd.serve_forever()