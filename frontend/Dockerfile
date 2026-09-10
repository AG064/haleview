FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts eslint.config.js index.html ./
COPY public ./public
COPY src ./src
COPY tests ./tests
RUN npm run lint && npm test && npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /var/cache/nginx /run
USER nginx
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
