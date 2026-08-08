# Anime Backend API

Backend de scraping + cuentas para el proyecto de anime. Node.js + TypeScript + Express + PostgreSQL (Prisma).

- **Base URL (producción):** `https://backend-anime-production-7f7c.up.railway.app`
- **Docs interactivas (Swagger):** `https://backend-anime-production-7f7c.up.railway.app/api/docs`
- **Local:** `http://localhost:4000` (`npm run dev`)

Todas las respuestas tienen el mismo sobre:

```json
{ "success": true, "data": { /* ... */ } }
{ "success": false, "error": "mensaje", "status": 400 }
```

---

## 1. CORS y cookies

La API usa **cookies HttpOnly** para la sesión (login/registro). Para que el navegador las mande:

- El frontend tiene que pedir con `credentials: 'include'` (fetch) o `withCredentials: true` (axios).
- El dominio del frontend tiene que estar en `ALLOWED_ORIGINS` en las variables de entorno de Railway. **Avisame la URL del frontend (Vercel, etc.) apenas la tengas para agregarla — si no, el navegador bloquea todo por CORS.**

---

## 2. Catálogo / Scraper (`/api/v1/anime/*`)

No requiere sesión.

| Endpoint | Qué hace |
|---|---|
| `GET /search?q=&domain=` | Búsqueda. Sin `domain`, busca en todos los proveedores en paralelo. |
| `GET /info?url=` | Ficha completa: sinopsis, géneros, episodios, imagen/backdrop de alta calidad (ver sección 4). |
| `GET /episode?url=&includeMega=&excludeServers=` | Servidores de video (SUB/DUB) de un episodio. |
| `GET /catalog?provider=&page=&genre=` | Catálogo paginado. `provider`: `animeav1` (default) o `animeflv`. |
| `GET /resolve?url=` | Resuelve un embed (StreamTape/VOE/etc.) a la URL directa reproducible. |
| `GET /status` | Estado en vivo de cada proveedor (para debug, no hace falta usarlo en el front). |
| `GET /image-proxy?u=` | Proxy de imágenes. **No armar esta URL a mano** — ver sección 4. |

Los `url=` de `/info`, `/episode` y `/resolve` son las URLs que ya vienen en el campo `url`/`slug` de los resultados de `/search` o `/catalog`.

---

## 3. Autenticación (`/api/auth/*`)

| Endpoint | Body | Qué hace |
|---|---|---|
| `POST /register` | `{ email, username, password, confirmPassword }` | Crea cuenta. Devuelve `{ user, accessToken }` + setea cookies. |
| `POST /login` | `{ email, password }` | Igual que arriba. |
| `POST /logout` | — | Revoca el refresh token y limpia cookies. |
| `POST /refresh-token` | — (usa la cookie) | Renueva el access token (rota el refresh token). |
| `GET /verify-email?token=` | — | Verifica el email (el token se loguea en consola del server por ahora, no se manda mail real todavía). |

Rate limit propio: **5 intentos/minuto por IP** en estos endpoints.

El `accessToken` también se devuelve en el body por si preferís mandarlo como `Authorization: Bearer <token>` en vez de depender de la cookie.

---

## 4. Imágenes: siempre usar el campo tal cual viene

Los campos `image` y `backdrop` de `/search`, `/info` y `/catalog` **ya vienen listos para usar** como `src` de una imagen:

```json
"image": "/api/v1/anime/image-proxy?u=X7I9jWqY0xmVUu-CeDkfRk8..."
```

- Es una ruta **relativa** — hay que anteponerle la base URL del backend.
- El `u=...` es la URL real cifrada (AES). **No se debe reconstruir ni editar esa query string.**
- No hace falta (ni va a funcionar) armar `?url=` a mano con la URL de AnimeAV1/AnimeFLV directamente.

**Si usan `next/image` de Next.js:** hay que agregar el dominio del backend a `images.remotePatterns` en `next.config.ts`, si no Next bloquea la imagen aunque la URL sea válida:

```ts
// next.config.ts
images: {
  remotePatterns: [
    { protocol: 'https', hostname: 'backend-anime-production-7f7c.up.railway.app' },
  ],
}
```

**Sobre la calidad:** `/info` mejora automáticamente `image` (cover) y `backdrop` (banner ancho, ideal para hero/slider) usando AniList cuando el anime tiene `malId` — bastante más nítidas que los covers chicos de los sitios de streaming. Esto NO pasa en `/search` ni `/catalog` (listados), que muestran el cover original del proveedor.

---

## 5. Perfil y cuenta (`/api/user/*`, requiere sesión)

| Endpoint | Body |
|---|---|
| `GET /profile` | — |
| `PUT /profile` | `{ username?, avatarUrl?, bio?, profileVisibility? }` (`PUBLIC` \| `FRIENDS` \| `PRIVATE`, default `PRIVATE`) |
| `PUT /change-password` | `{ currentPassword, newPassword }` |
| `DELETE /delete-account` | `{ password }` |

## 6. Favoritos, watchlist e historial (`/api/user/*`, requiere sesión)

| Endpoint | Body |
|---|---|
| `GET/POST /favorites`, `DELETE /favorites/:animeId` | `{ animeId, title, image?, rating?, type? }` |
| `GET/POST /watchlist`, `DELETE /watchlist/:animeId` | Igual forma que favoritos |
| `GET /history?page=&limit=` | Paginado |
| `POST /history` | `{ animeId, animeTitle, image?, episodeId, episodeTitle, progress?, duration? }` — `progress`/`duration` en segundos. Es upsert: repetir el mismo `episodeId` actualiza la fila en vez de duplicar. |
| `DELETE /history/:episodeId` | — |

`image` acepta tanto una URL absoluta como el path proxeado que ya devuelve el catálogo (guardá lo mismo que recibiste).

## 7. Perfil público (`/api/users/*`, sin sesión requerida)

| Endpoint | Qué hace |
|---|---|
| `GET /:username` | Perfil público. Si `profileVisibility` no es `PUBLIC` y no sos el dueño, `stats` viene `null`. |
| `GET /:username/favorites` | 403 si el perfil no es público (salvo que seas el dueño, logueado). |

## 8. Comentarios (`/api/comments`)

- `GET /?animeId=&episodeId=&page=&limit=` — sin sesión. Trae comentarios de primer nivel paginados, cada uno con sus respuestas anidadas en `replies` (hilos completos, sin paginar por separado). Sin `episodeId`, trae los comentarios generales del anime.
- `POST /` (sesión) — `{ animeId, episodeId?, parentId?, content }`. Mandar `parentId` para responder a otro comentario.
- `PUT /:id`, `DELETE /:id` (sesión, dueño) — editar/borrar (borrado lógico, no rompe el hilo).
- `POST /:id/like`, `DELETE /:id/like` (sesión) — like/unlike.

## 9. Calificaciones (`/api/ratings`)

Nota de la comunidad, **separada** del `score` que ya viene del proveedor en `/info` — mostrar las dos por separado en la ficha.

- `GET /?animeId=` — `{ animeId, average, count, myScore }`. `myScore` es `null` si no calificaste o no estás logueado.
- `POST /` (sesión) — `{ animeId, score }` (1-10). Upsert: repetir sobrescribe tu nota.
- `DELETE /:animeId` (sesión) — borra tu calificación.

---

## Notas

- Los videos **no se alojan** en el backend, solo se devuelven enlaces externos.
- Documentación completa e interactiva (para probar cualquier endpoint desde el navegador) en `/api/docs`.
