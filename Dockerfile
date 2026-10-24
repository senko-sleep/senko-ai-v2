# Senko assistant: Next.js app + Playwright browser in one container.
# The Playwright image already contains Chromium and its system libraries.
# Keep this tag in sync with the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CHROME_NO_SANDBOX=1

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
EXPOSE 3000

# Container hosts pass their own $PORT.
# Run Next directly (npx would keep an extra npm process in memory). The heap cap leaves
# room for Chrome on small instances; raise it with NODE_OPTIONS on bigger plans.
ENV NODE_OPTIONS=--max-old-space-size=320
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
