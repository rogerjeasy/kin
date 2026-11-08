# Kin's office line (the phone service) as a long-running container.
# Built from the repository root, so the workspace packages it imports are in reach:
#   docker build -f apps/voice/Dockerfile .
# Nothing deploys it yet: apps/voice/README.md lists what the owner still has to do.

# Install on the build machine's own platform: pnpm is a native program and
# fails under emulation. Everything installed here is plain JavaScript, so the
# result runs on an Arm machine unchanged.
FROM --platform=$BUILDPLATFORM node:24.19.0-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# Only the phone service and the workspace packages it depends on, without dev tools.
RUN pnpm install --frozen-lockfile --prod --filter "@kin/voice..."

FROM node:24.19.0-slim AS run
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/usr/local/share/rds-global-bundle.pem
# Aurora's certificates are signed by Amazon RDS's own authorities, which
# Node does not trust by default. TLS to the database is always verified.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/rds-global-bundle.pem
WORKDIR /repo
COPY --from=build --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/config ./packages/config
COPY --from=build --chown=node:node /repo/packages/domain ./packages/domain
COPY --from=build --chown=node:node /repo/packages/db ./packages/db
COPY --from=build --chown=node:node /repo/packages/telephony ./packages/telephony
COPY --from=build --chown=node:node /repo/apps/voice ./apps/voice
USER node
WORKDIR /repo/apps/voice
EXPOSE 4200
# Node runs the TypeScript directly. The settings come from the task.
CMD ["node", "src/main.ts"]
