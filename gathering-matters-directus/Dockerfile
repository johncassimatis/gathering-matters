# gathering-matters-directus/Dockerfile
# Reproducible baked-extension image for Directus.
# Build context is this directory (gathering-matters-directus/), which matches
# both local Docker Compose and the Render root directory.

FROM node:20-alpine AS build
WORKDIR /build
COPY extensions-src ./extensions-src

# Every extension declares its dependencies in tracked package.json +
# package-lock.json (including @directus/errors 2.4.0 for gm-intake and
# promote-submission). `npm ci` installs deterministically from the lockfile,
# and `directus-extension build` inlines all runtime deps into dist/, so the
# final image needs no node_modules at runtime.
RUN cd extensions-src/gm-library          && npm ci && npm run build
RUN cd extensions-src/gm-intake           && npm ci && npm run build
RUN cd extensions-src/promote-submission  && npm ci && npm run build

FROM directus/directus:12.0.2
COPY --from=build --chown=node:node /build/extensions-src/gm-library/package.json         /directus/extensions/directus-extension-gm-library/package.json
COPY --from=build --chown=node:node /build/extensions-src/gm-library/dist                  /directus/extensions/directus-extension-gm-library/dist
COPY --from=build --chown=node:node /build/extensions-src/gm-intake/package.json          /directus/extensions/directus-extension-gm-intake/package.json
COPY --from=build --chown=node:node /build/extensions-src/gm-intake/dist                   /directus/extensions/directus-extension-gm-intake/dist
COPY --from=build --chown=node:node /build/extensions-src/promote-submission/package.json  /directus/extensions/directus-extension-promote-submission/package.json
COPY --from=build --chown=node:node /build/extensions-src/promote-submission/dist          /directus/extensions/directus-extension-promote-submission/dist
