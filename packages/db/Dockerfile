# The database migration as a one-off task (infra/src/database-access.ts).
# Built from the repository root, so the workspace packages it imports are in reach:
#   docker build -f packages/db/Dockerfile .

# Install on the build machine's own platform: pnpm is a native program and
# fails under emulation. Everything installed here is plain JavaScript.
FROM --platform=$BUILDPLATFORM node:24.19.0-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# Only the database package and the workspace packages it depends on, without dev tools.
RUN pnpm install --frozen-lockfile --prod --filter "@kin/db..."

FROM node:24.19.0-slim AS run
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/usr/local/share/rds-global-bundle.pem
# Aurora's certificates are signed by Amazon RDS's own authorities, which
# Node does not trust by default. TLS to the database is always verified.
# Into a directory the image already has, so no new directory takes the file's mode.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/rds-global-bundle.pem
WORKDIR /repo
COPY --from=build --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/config ./packages/config
COPY --from=build --chown=node:node /repo/packages/domain ./packages/domain
COPY --from=build --chown=node:node /repo/packages/db ./packages/db
USER node
WORKDIR /repo/packages/db
# Node runs the TypeScript directly. The settings come from the task.
CMD ["node", "scripts/migrate.ts"]
