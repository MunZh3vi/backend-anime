import axios from "axios";
import { env } from "../config/env";
import { BROWSER_USER_AGENT } from "../config/constants";

// Cliente axios compartido por todos los scrapers. Se usa un User-Agent de
// navegador real porque varias fuentes bloquean el User-Agent por defecto de axios/node.
export const httpClient = axios.create({
  timeout: env.httpTimeoutMs,
  headers: {
    "User-Agent": BROWSER_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  },
  validateStatus: (status) => status >= 200 && status < 400,
});
