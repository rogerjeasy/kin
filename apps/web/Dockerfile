# The web app as one container (docs/architecture.md decision 35). Built from
# the repository root, so the workspace packages it imports are in reach:
#   docker build -f apps/web/Dockerfile .

# Install and build on the build machine's own platform. pnpm is a native
# program and fails under emulation, and the build's output is plain
# JavaScript apart from sharp, which the run stage replaces below.
FROM --platform=$BUILDPLATFORM node:24.19.0-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
# Only the web app and the workspace packages it depends on.
RUN pnpm install --frozen-lockfile --filter "@kin/web..."
RUN pnpm --filter @kin/web run build

FROM node:24.19.0-slim AS run
ARG TARGETARCH
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NODE_EXTRA_CA_CERTS=/usr/local/share/rds-global-bundle.pem
# Aurora's certificates are signed by Amazon RDS's own authorities, which
# Node does not trust by default. TLS to the database is always verified.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/rds-global-bundle.pem
WORKDIR /app
# Next's standalone output: the server and only the files it needs.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
# sharp, which optimises images, is the one native module. Fetch its binary
# for this image's platform, then load it so a mismatch fails the build, not
# the running site.
RUN set -eu; \
    cpu="$([ "$TARGETARCH" = "amd64" ] && echo x64 || echo "$TARGETARCH")"; \
    sharp_dir="$(find /app/node_modules/.pnpm -maxdepth 3 -type d -path '*/node_modules/sharp' | head -n 1)"; \
    version="$(node -p "require('$sharp_dir/package.json').version")"; \
    npm install --prefix /tmp/sharp --os=linux --cpu="$cpu" --libc=glibc --no-audit --no-fund --loglevel=error "sharp@$version"; \
    mkdir -p /app/node_modules/@img; \
    cp -R /tmp/sharp/node_modules/@img/. /app/node_modules/@img/; \
    rm -rf /tmp/sharp /root/.npm; \
    node -e "require('$sharp_dir'); console.log('sharp loads for linux-$cpu')"; \
    chown -R node:node /app/node_modules/@img
COPY --chown=node:node apps/web/docker/start.mjs ./apps/web/start.mjs
USER node
EXPOSE 3000
# start.mjs listens on every interface, whatever HOSTNAME the platform sets.
CMD ["node", "apps/web/start.mjs"]
