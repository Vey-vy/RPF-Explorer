# Hosting the UI

The Rust/Tauri backend still runs on each user's PC and reads that PC's game files. The optional remote-UI profile makes the Tauri WebView load the frontend from `https://rpf-ui.veyvy.space`; the default development and production profiles continue to use the locally bundled frontend.

## 1. Build and upload the static UI

From the repository root, build the Vite frontend:

```powershell
npm --prefix ui run build
```

First point the DNS record for `rpf-ui.veyvy.space` at your server. Once DNS resolves, create the document root and upload the **contents** of `ui/dist/`, keeping the generated `assets/` directory next to `index.html`:

```powershell
ssh user@YOUR_SERVER "sudo mkdir -p /var/www/rpf-ui"
scp -r ui/dist/* user@YOUR_SERVER:/var/www/rpf-ui/
```

Replace `user@YOUR_SERVER` with your SSH account and server address. Configure the web server to:

- Serve the domain over HTTPS with a valid certificate.
- Serve `index.html` as the entry point and fall back to it for unknown paths.
- Use the Content Security Policy below (or an equivalent policy that keeps the same restrictions).

For Nginx, use your TLS certificate paths in a server block like this:

```nginx
server {
    listen 80;
    server_name rpf-ui.veyvy.space;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name rpf-ui.veyvy.space;
    ssl_certificate /etc/letsencrypt/live/rpf-ui.veyvy.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rpf-ui.veyvy.space/privkey.pem;
    root /var/www/rpf-ui;
    index index.html;

    add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cdn.veyvy.space; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost https://ipc.localhost; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`'unsafe-inline'` is needed for inline style attributes currently used by the game tree and progress bars. Inline scripts remain blocked. The image allowlist includes the existing game-art CDN; the `connect-src` entries allow Tauri's local IPC bridge.

## 2. Build the desktop app for the hosted UI

After uploading the frontend, build the installer from the repository root:

```powershell
npm --prefix ui run tauri:remote
```

This uses [tauri.remote.conf.json](../tauri.remote.conf.json), which points `frontendDist` at the hosted URL and skips the local Vite build. The normal `npm --prefix ui run tauri -- build` command remains the self-contained, locally bundled build.

## Security notes

- The remote IPC capability in [capabilities/default.json](../capabilities/default.json) allows only `https://rpf-ui.veyvy.space/*`; do not replace it with a wildcard domain.
- The hosted JavaScript is trusted code with access to the app's registered Tauri commands. Keep control of DNS, TLS certificates, and deployment credentials for this domain. A compromise of the hosted UI could invoke those commands against the user's local game files.
- The app still needs to be installed and running on the PC to browse local game archives. Hosting the UI does not make the game files available to a regular browser or to the server.
- Keep the server policy limited to the required sources. Do not add `unsafe-eval`, wildcard script sources, or broad remote IPC domains.
