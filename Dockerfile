# One container serving the built web app as static files. It holds no keys and never signs: the simulator runs
# in the visitor's browser and the Lifecycle page reads Electrum straight from the browser.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The libauth fork that SolidCash and mem-cash need is a tarball in vendor/ (docs/decisions/0010): copy it before
# installing, so the install needs no git.
COPY vendor/ ./vendor/
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build && npx tsx scripts/nginx-conf.ts deploy/nginx.conf.tmpl > nginx.conf

FROM nginx:1.30.6-alpine
COPY --from=build /app/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /srv/jamin
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
