// Lista curada a mano, no scrapeada: ninguna de las 6 fuentes expone un
// endpoint ni un <select> estático con la lista completa de géneros en el
// HTML sin JS, así que no hay forma confiable de mantenerla sincronizada
// scrapeando. Los slugs coinciden con los que espera AnimeFLV en
// /catalog?provider=animeflv&genre=<slug> (el único proveedor con filtro de
// género soportado hoy); para el resto sirve solo para poblar un filtro en
// el frontend.
export interface StaticGenre {
  slug: string;
  name: string;
}

export const ANIME_GENRES: StaticGenre[] = [
  { slug: "accion", name: "Acción" },
  { slug: "artes-marciales", name: "Artes Marciales" },
  { slug: "aventura", name: "Aventura" },
  { slug: "carreras", name: "Carreras" },
  { slug: "ciencia-ficcion", name: "Ciencia Ficción" },
  { slug: "comedia", name: "Comedia" },
  { slug: "demencia", name: "Demencia" },
  { slug: "demonios", name: "Demonios" },
  { slug: "deportes", name: "Deportes" },
  { slug: "drama", name: "Drama" },
  { slug: "ecchi", name: "Ecchi" },
  { slug: "escolares", name: "Escolares" },
  { slug: "espacio", name: "Espacio" },
  { slug: "fantasia", name: "Fantasía" },
  { slug: "harem", name: "Harem" },
  { slug: "historico", name: "Histórico" },
  { slug: "infantil", name: "Infantil" },
  { slug: "josei", name: "Josei" },
  { slug: "juegos", name: "Juegos" },
  { slug: "magia", name: "Magia" },
  { slug: "mecha", name: "Mecha" },
  { slug: "militar", name: "Militar" },
  { slug: "misterio", name: "Misterio" },
  { slug: "musica", name: "Música" },
  { slug: "parodia", name: "Parodia" },
  { slug: "policia", name: "Policía" },
  { slug: "psicologico", name: "Psicológico" },
  { slug: "recuentos-de-la-vida", name: "Recuentos de la Vida" },
  { slug: "romance", name: "Romance" },
  { slug: "samurai", name: "Samurái" },
  { slug: "seinen", name: "Seinen" },
  { slug: "shoujo", name: "Shoujo" },
  { slug: "shoujo-ai", name: "Shoujo Ai" },
  { slug: "shounen", name: "Shounen" },
  { slug: "shounen-ai", name: "Shounen Ai" },
  { slug: "sobrenatural", name: "Sobrenatural" },
  { slug: "superpoderes", name: "Superpoderes" },
  { slug: "suspenso", name: "Suspenso" },
  { slug: "terror", name: "Terror" },
  { slug: "tragedia", name: "Tragedia" },
  { slug: "vampiros", name: "Vampiros" },
  { slug: "yaoi", name: "Yaoi" },
  { slug: "yuri", name: "Yuri" },
];
