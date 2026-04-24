FROM node:22-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY apps/server apps/server
COPY packages/shared packages/shared
COPY tsconfig.json tsconfig.json

ENV PORT=8787

EXPOSE 8787

CMD ["pnpm", "--filter", "@open-watch-party/server", "start"]
