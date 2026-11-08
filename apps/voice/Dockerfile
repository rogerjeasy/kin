# Kin's phone service (Twilio's webhook: Kin's call to a parent about a shift, and
# the office line) as a long-running container.
# Built from the repository root, so the workspace packages it imports are in reach:
#   docker build -f apps/voice/Dockerfile .
# The KinVoice stack (infra/src/voice-stack.ts) builds it for App Runner when
# kin:voice is true in infra/cdk.json, and the settings below are filled by that
# stack from Secrets Manager. The office line needs numbers (KIN_OFFICE_LINE_NUMBERS)
# that are not configured; without them it answers every call with "no record".
# apps/voice/README.md says what only a live Twilio account proves.

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
# Node runs the TypeScript directly. The settings come from the service.
CMD ["node", "src/main.ts"]
