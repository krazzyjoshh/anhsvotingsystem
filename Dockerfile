FROM node:24-bookworm-slim AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
# The hosting platform can inject NODE_ENV=production during builds.
# Vite is a devDependency and is required only in this builder stage.
RUN npm ci --include=dev
COPY web/ ./
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force
COPY server/src/ ./server/src/
COPY server/scripts/start-production.js ./server/scripts/start-production.js
COPY server/scripts/reset-admin.js ./server/scripts/reset-admin.js
COPY server/scripts/diagnose.js ./server/scripts/diagnose.js
COPY chain/target/idl/voting_system.json ./chain/target/idl/voting_system.json
COPY --from=frontend /app/web/dist ./web/dist
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 DB_PATH=/data/data.sqlite STORAGE_PATH=/data REQUIRE_PERSISTENT_STORAGE=true
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/scripts/start-production.js"]
