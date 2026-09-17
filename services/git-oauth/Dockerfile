FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./server.mjs
ENV PORT=34142
USER node
EXPOSE 34142
CMD ["node", "server.mjs"]
