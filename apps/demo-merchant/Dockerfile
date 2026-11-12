# The demo pharmacy (a stand-in seller with its own PayPal sandbox app) as a
# long-running container. Built from the repository root, so the workspace
# packages it imports are in reach:
#   docker build -f apps/demo-merchant/Dockerfile .
# The KinDemoMerchant stack (infra/src/demo-merchant-stack.ts) builds it for App
# Runner when kin:demoMerchant is true in infra/cdk.json, and fills its settings
# from Secrets Manager. It refuses to start without KIN_DEMO_MERCHANT_SIGNING_SECRET.

# Install on the build machine's own platform: pnpm is a native program and
# fails under emulation. Everything installed here is plain JavaScript, so the
# result runs on another architecture unchanged.
FROM --platform=$BUILDPLATFORM node:24.19.0-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# Only the pharmacy and the workspace packages it depends on, without dev tools.
RUN pnpm install --frozen-lockfile --prod --filter "@kin/demo-merchant..."

FROM node:24.19.0-slim AS run
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/config ./packages/config
COPY --from=build --chown=node:node /repo/packages/domain ./packages/domain
COPY --from=build --chown=node:node /repo/packages/auth ./packages/auth
COPY --from=build --chown=node:node /repo/apps/demo-merchant ./apps/demo-merchant
USER node
WORKDIR /repo/apps/demo-merchant
EXPOSE 4100
# Node runs the TypeScript directly. The settings come from the service.
CMD ["node", "src/main.ts"]
