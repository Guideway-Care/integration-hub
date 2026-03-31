FROM node:20-slim

WORKDIR /app

COPY cloud-run/package.json .
RUN npm install --production

COPY cloud-run/index.js .
COPY cloud-run/loader.js .

CMD ["node", "index.js"]
