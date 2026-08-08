# Imagen oficial de Puppeteer: trae Node.js + Chromium + todas las librerías
# de sistema que Chromium necesita para correr en modo headless (evita el
# problema más común al desplegar Puppeteer en PaaS: "Failed to launch the
# browser process" por librerías faltantes).
FROM ghcr.io/puppeteer/puppeteer:23.11.1

# Puppeteer no necesita descargar su propio Chromium: ya está en la imagen.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

USER root
WORKDIR /app

COPY package*.json ./
# NODE_ENV todavía no está en "production" acá a propósito: npm necesita
# instalar devDependencies (typescript) para poder compilar con tsc.
RUN npm ci

COPY . .
RUN npm run build

# El motor de descarga escribe episodios acá si se usa (ver README sobre
# almacenamiento efímero en Railway sin un Volume adjunto).
RUN mkdir -p /app/downloads && chown -R pptruser:pptruser /app

# Recién ahora, para que solo afecte el comportamiento en tiempo de ejecución.
ENV NODE_ENV=production

USER pptruser

EXPOSE 4000
CMD ["npm", "start"]
