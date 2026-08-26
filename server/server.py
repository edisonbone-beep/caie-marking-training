#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CAIE Marking Training - 国内数据后端
====================================
零依赖（仅 Python 3 标准库），单文件部署。

运行:
    python3 server.py                      # 默认端口 3000
    PORT=8080 python3 server.py            # 自定义端口
    ADMIN_PWD=新密码 python3 server.py      # 自定义管理密码（默认 123456，上线务必修改）

数据存储在同目录 data/results.json（自动创建，原子写入）。

接口:
    GET    /api/health    健康检查
    GET    /api/auth      校验管理密码（请求头 x-admin-password），200 / 401
    GET    /api/results   获取全部批卷记录（需管理密码）
    POST   /api/results   提交一条批卷记录（公开，无需密码）
    DELETE /api/results   清空全部记录（需管理密码）

生产部署建议（轻量服务器）:
    1. 上传本文件到 /opt/marking/server.py
    2. 创建 systemd 服务 /etc/systemd/system/marking-api.service:
         [Unit]
         Description=CAIE Marking API
         After=network.target
         [Service]
         Environment=ADMIN_PWD=你的密码
         ExecStart=/usr/bin/python3 /opt/marking/server.py
         Restart=always
         [Install]
         WantedBy=multi-user.target
       然后 systemctl enable --now marking-api
    3. nginx 配置: 静态站点根目录指向网站文件，并反向代理 /api -> 127.0.0.1:3000:
         location /api/ {
             proxy_pass http://127.0.0.1:3000/api/;
             proxy_set_header Host $host;
         }
"""

import json
import os
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('PORT', '3000'))
ADMIN_PWD = os.environ.get('ADMIN_PWD', '123456')
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'results.json')

_lock = threading.Lock()


def load_rows():
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (IOError, ValueError):
        return []


def save_rows(rows):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    tmp = DATA_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    # ---------- helpers ----------
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        return self.headers.get('x-admin-password') == ADMIN_PWD

    def log_message(self, fmt, *args):
        print('[%s] %s' % (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), fmt % args))

    # ---------- methods ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/health':
            return self._send_json(200, {'ok': True})
        if path == '/api/auth':
            return self._send_json(200, {'ok': True}) if self._authorized() \
                else self._send_json(401, {'error': 'unauthorized'})
        if path == '/api/results':
            if not self._authorized():
                return self._send_json(401, {'error': 'unauthorized'})
            with _lock:
                rows = load_rows()
            rows.sort(key=lambda r: r.get('created_at', ''), reverse=True)
            return self._send_json(200, rows)
        return self._send_json(404, {'error': 'not found'})

    def do_POST(self):
        path = self.path.split('?')[0]
        if path != '/api/results':
            return self._send_json(404, {'error': 'not found'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length > 5 * 1024 * 1024:
                return self._send_json(413, {'error': 'payload too large'})
            rec = json.loads(self.rfile.read(length).decode('utf-8'))
        except (ValueError, TypeError):
            return self._send_json(400, {'error': 'invalid json'})
        rec['created_at'] = rec.get('created_at') or datetime.now().isoformat()
        with _lock:
            rows = load_rows()
            rec['id'] = max([r.get('id', 0) for r in rows] + [0]) + 1
            rows.append(rec)
            save_rows(rows)
        return self._send_json(200, {'ok': True, 'id': rec['id']})

    def do_DELETE(self):
        path = self.path.split('?')[0]
        if path != '/api/results':
            return self._send_json(404, {'error': 'not found'})
        if not self._authorized():
            return self._send_json(401, {'error': 'unauthorized'})
        with _lock:
            count = len(load_rows())
            save_rows([])
        return self._send_json(200, {'ok': True, 'cleared': count})


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('Marking API listening on :%d' % PORT)
    server.serve_forever()
