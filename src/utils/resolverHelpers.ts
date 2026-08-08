import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import http from "node:http";
import https from "node:https";

export const UA_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

const axiosInstance = axios.create({
  timeout: 10000,
  headers: { "User-Agent": UA_FIREFOX },
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
});

export async function axiosGet(url: string, opts: AxiosRequestConfig = {}): Promise<AxiosResponse<string>> {
  return axiosInstance.get<string>(url, { responseType: "text", ...opts });
}

/** El dominio público de StreamWish rota constantemente por bloqueos DMCA. */
export function transformObeywish(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("obeywish.com")) {
      u.hostname = "asnwish.com";
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}
