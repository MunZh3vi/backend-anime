import path from "path";
import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Anime Backend API",
      version: "1.0.0",
      description:
        "API de catálogo de anime (scraping multi-proveedor: AnimeAV1, AnimeFLV, JKAnime, TioAnime, MonosChinos, HentaiLA). Los videos NO se alojan en este servidor, solo se devuelven enlaces externos.",
    },
    servers: [{ url: "/api", description: "Base path de la API" }],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "accessToken",
          description: "Cookie HttpOnly seteada por /auth/login o /auth/register. También se acepta Authorization: Bearer <accessToken>.",
        },
      },
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            username: { type: "string" },
            avatarUrl: { type: "string", nullable: true },
            bio: { type: "string", nullable: true },
            subscriptionStatus: { type: "string", example: "free" },
            isEmailVerified: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        SearchResultItem: {
          type: "object",
          properties: {
            id: { type: "string", nullable: true },
            title: { type: "string", example: "One Piece" },
            slug: { type: "string", nullable: true },
            url: { type: "string", nullable: true, example: "https://www3.animeflv.net/anime/one-piece" },
            image: { type: "string", nullable: true },
            backdrop: { type: "string", nullable: true },
            type: { type: "string", nullable: true, example: "TV" },
            score: { type: "number", nullable: true },
            status: { type: "string", nullable: true },
            year: { type: "string", nullable: true },
            provider: { type: "string", nullable: true, example: "AnimeFLV" },
          },
        },
        AnimeInfoData: {
          type: "object",
          properties: {
            id: { nullable: true },
            title: { type: "string", nullable: true },
            titleJapanese: { type: "string", nullable: true },
            description: { type: "string", nullable: true },
            image: { type: "string", nullable: true },
            backdrop: { type: "string", nullable: true },
            status: { type: "string", nullable: true },
            type: { type: "string", nullable: true },
            year: { type: "string", nullable: true },
            score: { type: "number", nullable: true },
            votes: { type: "number", nullable: true },
            totalEpisodes: { type: "integer" },
            genres: {
              type: "array",
              items: { type: "object", properties: { name: { type: "string" }, slug: { type: "string", nullable: true } } },
            },
            episodes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  number: { type: "integer" },
                  title: { type: "string" },
                  url: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        VideoLink: {
          type: "object",
          properties: {
            server: { type: "string", example: "StreamTape" },
            url: { type: "string" },
            quality: { type: "string", nullable: true },
          },
        },
        EpisodeLinksData: {
          type: "object",
          properties: {
            episode: { type: "integer", nullable: true },
            title: { type: "string" },
            variants: {
              type: "object",
              properties: { SUB: { type: "integer" }, DUB: { type: "integer" } },
            },
            streamLinks: {
              type: "object",
              properties: {
                SUB: { type: "array", items: { $ref: "#/components/schemas/VideoLink" } },
                DUB: { type: "array", items: { $ref: "#/components/schemas/VideoLink" } },
              },
            },
            downloadLinks: {
              type: "object",
              properties: {
                SUB: { type: "array", items: { $ref: "#/components/schemas/VideoLink" } },
                DUB: { type: "array", items: { $ref: "#/components/schemas/VideoLink" } },
              },
            },
          },
        },
        CatalogData: {
          type: "object",
          properties: {
            page: { type: "integer" },
            genre: { type: "string", nullable: true },
            count: { type: "integer" },
            hasMore: { type: "boolean" },
            results: { type: "array", items: { $ref: "#/components/schemas/SearchResultItem" } },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Mensaje de error" },
            status: { type: "integer", example: 400 },
          },
        },
      },
    },
  },
  // glob (dependencia de swagger-jsdoc) trata "\" como carácter de escape en
  // el patrón, así que en Windows path.join() rompe el match silenciosamente
  // (produce "src\routes\*.{ts,js}"). Se normaliza a barras "/" siempre.
  apis: [path.join(__dirname, "../routes/*.{ts,js}").split(path.sep).join("/")],
};

export const swaggerSpec = swaggerJsdoc(options);
