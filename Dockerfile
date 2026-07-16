ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm exec next build

FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV MD_SHARE_DATA_DIR=/data
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/llms.txt ./public/llms.txt
# Agent skill and API reference served by GET /skill.md and /api.md with the
# instance URL filled in.
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/docs/API.md ./docs/API.md
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
