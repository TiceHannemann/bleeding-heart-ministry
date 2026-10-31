# Bleeding Heart movement relay
# Lets the Ministry site read the EarthMC live map's player feed from your own computer.
# Run:  python relay.py   (Python 3, nothing to install), then press "Use relay" on Movement Watch.
import http.server, urllib.request
SRC = "https://map.earthmc.net/tiles/players.json"
class Relay(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            req = urllib.request.Request(SRC, headers={"User-Agent": "BleedingHeart-MovementRelay"})
            data, code = urllib.request.urlopen(req, timeout=10).read(), 200
        except Exception as e:
            data, code = str(e).encode(), 502
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *args):
        pass
print("Relay running. Feed source: http://localhost:8787/players.json  (Ctrl+C to stop)")
http.server.ThreadingHTTPServer(("127.0.0.1", 8787), Relay).serve_forever()
