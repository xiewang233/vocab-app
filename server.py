"""
邪王真翔的背单词小工具 — 轻量服务器
纯前端离线应用，此服务仅用于分发静态文件。
"""
import http.server
import socketserver
import socket
import os
import urllib.parse

DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8520

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        # Route / to templates/index.html
        path = urllib.parse.urlparse(self.path).path
        if path == '/' or path == '':
            self.path = '/templates/index.html'
        elif path == '/manifest.json':
            self.path = '/static/manifest.json'
        elif path == '/sw.js':
            self.path = '/static/sw.js'
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        # MIME types for PWA
        if self.path.endswith('.json'):
            self.send_header('Content-Type', 'application/json; charset=utf-8')
        elif self.path.endswith('.js'):
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
        super().end_headers()

    def log_message(self, format, *args):
        pass

def get_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return '127.0.0.1'

if __name__ == '__main__':
    ip = get_ip()
    print(f'\n  邪王真翔的背单词小工具 v2.0')
    print(f'  ============================')
    print(f'  电脑: http://localhost:{PORT}')
    print(f'  手机: http://{ip}:{PORT}')
    print(f'  手机打开后 -> 添加到主屏幕 = 桌面App')
    print(f'  按 Ctrl+C 停止\n')

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n服务器已停止')
