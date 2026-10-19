FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.mjs model.js app.js index.html styles.css ./
COPY --chown=node:node backend ./backend
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=4173 DATABASE_PATH=/app/data/seven.sqlite
EXPOSE 4173
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
