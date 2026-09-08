#!/usr/bin/env python3
"""سرویس AI قلابی، فقط برای تست محلی خط لوله ingest.

هرچه بک‌اند Go می‌فرستد را چاپ می‌کند و 202 برمی‌گرداند — یعنی می‌شود بدون
بالا آوردن سرویس واقعی همکار، مسیر «آپلود → outbox → worker → تحویل» را
انتها به انتها دید.

    python3 scripts/fake_ai_service.py
    # و در .env:  AI_SERVICE_BASE_URL=http://127.0.0.1:8899
"""
import json, http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n)
        print("PATH", self.path, flush=True)
        print("AUTH", self.headers.get('Authorization'), flush=True)
        print("BODY", body.decode(), flush=True)
        self.send_response(202); self.send_header('Content-Type','application/json'); self.end_headers()
        self.wfile.write(json.dumps({"jobId":"fake-job-1","status":"queued"}).encode())
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 8899), H).serve_forever()
