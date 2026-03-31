#!/bin/sh
set -e

API_HOST=$(echo "$API_UPSTREAM" | sed 's|https\?://||' | sed 's|/.*||')
export API_UPSTREAM API_HOST

envsubst '${API_UPSTREAM} ${API_HOST}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

echo "API_UPSTREAM=$API_UPSTREAM"
echo "API_HOST=$API_HOST"
cat /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
