import NodeCache from "node-cache";

export interface CachedImage {
  contentType: string;
  buffer: Buffer;
}

// El proxy le pega a la fuente en cada request; esto evita re-descargar la
// misma imagen (portadas/banners se piden una y otra vez desde el catálogo)
// dentro de la ventana de TTL. Tope de tamaño por item para no acumular
// backdrops gigantes indefinidamente en memoria.
const MAX_CACHEABLE_BYTES = 5 * 1024 * 1024;
const IMAGE_CACHE_TTL_SECONDS = 6 * 60 * 60;

const store = new NodeCache({ stdTTL: IMAGE_CACHE_TTL_SECONDS, checkperiod: 600, useClones: false });

export function getCachedImage(url: string): CachedImage | undefined {
  return store.get<CachedImage>(url);
}

export function setCachedImage(url: string, image: CachedImage): void {
  if (image.buffer.byteLength > MAX_CACHEABLE_BYTES) return;
  store.set(url, image);
}
