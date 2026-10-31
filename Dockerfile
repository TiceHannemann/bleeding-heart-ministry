# Kingdom of The Bleeding Heart — hosted server with the hourly collector.
# The Playwright image already contains Chromium and its system libraries; its version must match server/package.json.
FROM mcr.microsoft.com/playwright:v1.48.2-jammy
WORKDIR /srv
COPY server/package.json server/
RUN cd server && npm install --omit=dev
COPY app app
COPY assets assets
COPY server server
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["node", "server/server.js"]
