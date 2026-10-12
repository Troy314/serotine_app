# Serotine App — image de production (un seul process : API Express + site React buildé)
# Voir compose.yaml pour le lancement, et _architecture/serotine_app.md (topinambours).

# ── Étape 1 : build du front + dépendances de prod ───────────────────────────
FROM node:20.17-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── Étape 2 : image finale ───────────────────────────────────────────────────
FROM node:20.17-bookworm-slim
ENV NODE_ENV=production \
    PORT=3101
WORKDIR /app

# pg_dump / pg_restore (sauvegardes de la base privée, voir server/db.js) — même version majeure que le service db.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates gnupg curl \
 && install -d /usr/share/keyrings \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y gnupg curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/dist ./dist

# data/ (sauvegardes pg_dump, tableurs d'import) est monté depuis l'hôte, jamais copié dans l'image.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3101
CMD ["node", "server/index.js"]
