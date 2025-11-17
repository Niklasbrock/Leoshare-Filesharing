# Reverse Proxy Setup Options

## Option A: Using nginx (Recommended)

1. Install nginx for Windows
2. Configure nginx to listen on port 80 and proxy to localhost:3001
3. Keep your app on port 3001 internally

nginx.conf:
```nginx
server {
    listen 80;
    server_name share.leolord.dk;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Option B: Using IIS (Windows Native)

1. Install IIS with URL Rewrite module
2. Create a reverse proxy rule from port 80 to port 3001
3. Configure Application Request Routing (ARR)

## Option C: Using Caddy (Easiest)

1. Download Caddy server
2. Create Caddyfile:
```
share.leolord.dk {
    reverse_proxy localhost:3001
}
```
3. Run: `caddy run`