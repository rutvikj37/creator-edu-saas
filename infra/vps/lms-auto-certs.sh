#!/usr/bin/env bash
# TechX LMS: automatic HTTPS for academy addresses (installed as /usr/local/bin/lms-auto-certs).
# Runs every minute (systemd timer lms-certs.timer). For every academy address in the database
# (<slug>.lms.techxsolutions.io, or a verified own domain) of a tenant that is not deleted:
#   1. no certificate yet and DNS points here -> get one from Let's Encrypt (HTTP check, shared webroot)
#   2. write /etc/nginx/lms-portals/<address>.conf serving the LMS app
# A failed attempt waits an hour before retrying (Let's Encrypt limits). Files of removed addresses are taken down.
set -uo pipefail

ENV_FILE=/opt/lms/shared/.env
PORTALS=/etc/nginx/lms-portals
WEBROOT=/var/www/letsencrypt
STATE=/var/lib/lms-certs
log() { echo "[lms-certs] $*"; }
envv() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
mkdir -p "$PORTALS" "$WEBROOT" "$STATE"

ROOT=$(envv PLATFORM_ROOT_DOMAIN); APP_HOST=$(envv APP_HOST)
# mysql://user:pass@host:port/db
DBURL=$(envv DATABASE_URL); DBURL=${DBURL#mysql://}
DBUSER=${DBURL%%:*}; REST=${DBURL#*:}; DBPASS=${REST%%@*}; REST=${REST#*@}
DBHOST=${REST%%:*}; REST=${REST#*:}; DBPORT=${REST%%/*}; DBNAME=${REST#*/}; DBNAME=${DBNAME%%\?*}

SERVER_IP=$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

HOSTS=$(MYSQL_PWD="$DBPASS" mysql -N -B -h "$DBHOST" -P "$DBPORT" -u "$DBUSER" "$DBNAME" -e "
    SELECT DISTINCT LOWER(d.hostname) FROM TenantDomain d JOIN Tenant t ON t.id = d.tenantId
    WHERE t.status <> 'DELETED' AND (d.type = 'SUBDOMAIN' OR d.status = 'VERIFIED')") || { log "could not read academy addresses from MySQL"; exit 1; }

cert() {
    local host=$1
    [ -f "/etc/letsencrypt/live/$host/fullchain.pem" ] && return 0
    if [ -f "$STATE/failed-$host" ] && [ -n "$(find "$STATE/failed-$host" -mmin -60 2>/dev/null)" ]; then return 1; fi
    local ips
    ips=$(dig +short +time=3 +tries=1 A "$host" @1.1.1.1 2>/dev/null; dig +short +time=3 +tries=1 A "$host" @8.8.8.8 2>/dev/null)
    if ! grep -qx "$SERVER_IP" <<< "$ips"; then log "waiting for DNS: $host does not point to $SERVER_IP yet"; return 1; fi
    log "getting a certificate for $host"
    if certbot certonly --webroot -w "$WEBROOT" -d "$host" --non-interactive --agree-tos \
            --register-unsafely-without-email --keep-until-expiring --quiet; then
        rm -f "$STATE/failed-$host"; return 0
    fi
    touch "$STATE/failed-$host"; log "certificate failed for $host (will retry in an hour)"; return 1
}

write_conf() {
    local f=$1 tmp; tmp=$(mktemp); cat > "$tmp"
    if cmp -s "$tmp" "$f"; then rm -f "$tmp"; return 1; fi
    mv "$tmp" "$f" && chmod 644 "$f"; changed=1; return 0
}

changed=0; wanted=" "
for host in $HOSTS; do
    [[ "$host" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || { log "skip invalid address: $host"; continue; }
    [ "$host" = "$ROOT" ] || [ "$host" = "$APP_HOST" ] && continue
    wanted+="$host "
    if cert "$host"; then
        write_conf "$PORTALS/$host.conf" <<NGINX && log "live: https://$host"
# academy address - written by lms-auto-certs
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $host;
    ssl_certificate /etc/letsencrypt/live/$host/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$host/privkey.pem;
    include /etc/nginx/snippets/visacrm-ssl.conf;
    include /etc/nginx/snippets/lms-app.conf;
}
NGINX
    fi
done

for conf in "$PORTALS"/*.conf; do
    [ -e "$conf" ] || continue
    host=$(basename "$conf" .conf)
    if [[ "$wanted" != *" $host "* ]]; then rm -f "$conf"; log "removed: $host"; changed=1; fi
done

if [ "$changed" = 1 ]; then
    if nginx -t -q 2>/dev/null; then systemctl reload nginx; log "nginx reloaded"; else log "nginx config test failed; not reloading"; nginx -t; fi
fi
