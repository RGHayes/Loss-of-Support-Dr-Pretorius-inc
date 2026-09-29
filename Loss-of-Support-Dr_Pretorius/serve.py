"""Local dev server for the Loss of Support Form.

Sends the same security headers as production (see public/_headers) so the app
is always tested under the real Content-Security-Policy, and stands in for the
Netlify function so the send path can be exercised without the Netlify CLI.

Not used in production — Netlify serves the static files itself.

    python3 serve.py            # then open the address it prints

The port comes from the PORT environment variable when one is set, so several
of these can run side by side without colliding. It falls back to 8757.

Set DEV_SEND_MODE to 'ok' (default), 'reject' or 'down' to try each branch of
the send screen. It never sends real email and never writes a submission down.
"""
import http.server
import json
import os
import socketserver

PORT = int(os.environ.get('PORT') or 8757)

# Serve the directory Netlify publishes, so local and production match.
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public'))

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; "
    "base-uri 'none'; object-src 'none'"
)

SECURITY_HEADERS = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
}

DEV_SEND_MODE = os.environ.get('DEV_SEND_MODE', 'ok')
MAX_BODY = 5_600_000

# Set DEV_SAVE_PDF=1 to drop the generated PDF next to this file so the layout
# can be checked by eye. Off by default, local only, and *.pdf is git-ignored.
# The real Netlify function has no equivalent: it never writes anything down.
DEV_SAVE_PDF = os.environ.get('DEV_SAVE_PDF') == '1'


class SecureHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)
        super().end_headers()

    def do_GET(self):
        # Stands in for the form-recipients function. DEV_PAUSED=1 exercises the
        # paused branch, and DEV_RECIPIENTS overrides the menu, so both can be
        # tried without a console running.
        if self.path.split('?')[0] == '/api/form-recipients':
            people = os.environ.get('DEV_RECIPIENTS', '')
            if people:
                recipients = []
                for entry in people.split(','):
                    email = entry.strip()
                    if '@' in email:
                        recipients.append({
                            'label': email.split('@')[0].replace('.', ' ').title(),
                            'email': email,
                        })
            else:
                recipients = [
                    {'label': 'IFTFC', 'email': 'richard@iftfc.co.za'},
                    {'label': 'Admin Test', 'email': 'richard@iftfc.com'},
                ]

            paused = os.environ.get('DEV_PAUSED') == '1'
            body = json.dumps({
                'recipients': recipients,
                'paused': paused,
                'pausedMessage': ('This form is temporarily unavailable. '
                                  'Please telephone the office on 012 452 8200.') if paused else '',
                'source': 'dev',
            }).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()

    def do_POST(self):
        if self.path != '/api/send-form':
            self.send_error(404)
            return

        # A paused form refuses before any work is done, in the firm's words.
        if os.environ.get('DEV_PAUSED') == '1':
            body = json.dumps({
                'error': 'This form is temporarily unavailable. '
                         'Please telephone the office on 012 452 8200.',
                'code': 'PAUSED',
            }).encode()
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_BODY:
            self.send_error(413)
            return
        raw = self.rfile.read(length)

        if DEV_SEND_MODE == 'down':
            self.send_error(502)
            return

        try:
            payload = json.loads(raw or b'{}')
        except ValueError:
            payload = {}

        pdf = str(payload.get('pdfBase64', ''))
        # The same magic-number check the real function makes.
        import base64
        try:
            head = base64.b64decode(pdf[:12] + '==', validate=False)[:5]
        except Exception:
            head = b''

        if DEV_SEND_MODE == 'reject' or head != b'%PDF-':
            status, body = 400, b'{"error":"The attached document was not a valid PDF."}'
        else:
            status, body = 200, b'{"ok":true}'

        if DEV_SAVE_PDF and status == 200:
            out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               'sja-loss-of-support', 'dev-last-form.pdf')
            with open(out, 'wb') as fh:
                fh.write(base64.b64decode(pdf))
            print(f'[dev] wrote {out}')

        # Never log the submission itself — only its size.
        print(f'[dev] /api/send-form -> {status} '
              f'(pdf {len(pdf)} b64 chars, about {len(pdf) * 3 // 4 // 1024} KB)')

        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Request lines only — never echo a query string.
        super().log_message('%s', args[0] if args else '')


# Loopback only — never expose a form full of test data to the local network.
# Without this, stopping the server and starting it again straight away fails
# with "Address already in use" for as long as the socket sits in TIME_WAIT —
# which looks like a broken script rather than a kernel timer.
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(('127.0.0.1', PORT), SecureHandler) as httpd:
    print(f'Serving on http://127.0.0.1:{PORT} with production security headers')
    httpd.serve_forever()
