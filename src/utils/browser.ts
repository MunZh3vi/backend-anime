import puppeteer, { Browser, Page } from "puppeteer";
import { logger } from "./logger";

let browserInstance: Browser | null = null;

// Semáforo simple para no abrir más de N páginas Puppeteer a la vez (RAM).
let activePages = 0;
const MAX_CONCURRENT_PAGES = Number(process.env.MAX_CONCURRENT_PAGES) || 2;
const queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(resolve);
  });
}

function releaseSlot(): void {
  activePages--;
  if (queue.length > 0) {
    activePages++;
    const next = queue.shift();
    next?.();
  }
}

export async function getBrowser(): Promise<Browser> {
  if (browserInstance) {
    try {
      await browserInstance.version();
      return browserInstance;
    } catch {
      logger.warn("Instancia de Puppeteer muerta, relanzando...");
      browserInstance = null;
    }
  }

  browserInstance = await puppeteer.launch({
    headless: true,
    // En Docker (imagen ghcr.io/puppeteer/puppeteer) el Chromium ya viene
    // instalado en el sistema; PUPPETEER_EXECUTABLE_PATH le dice a Puppeteer
    // que lo use en vez de buscar el suyo propio (que no se descarga en el build).
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--no-zygote",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-component-extensions-with-background-pages",
      "--disable-extensions",
      "--disable-features=TranslateUI,BlinkGenPropertyTrees",
      "--disable-ipc-flooding-protection",
      "--disable-renderer-backgrounding",
      "--metrics-recording-only",
    ],
  });
  return browserInstance;
}

const BLOCKED_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);

async function withManagedPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      );
      return await fn(page);
    } finally {
      try {
        await page.evaluate(() => window.stop()).catch(() => {});
        await page.close({ runBeforeUnload: false });
      } catch (err) {
        logger.error("Error cerrando página de Puppeteer", { err });
      }
    }
  } finally {
    releaseSlot();
  }
}

export async function fetchPageContent(url: string): Promise<string> {
  return withManagedPage(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    return page.content();
  });
}

export async function scrapeWithPage<T>(url: string, scraperFn: () => T): Promise<T> {
  return withManagedPage(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    return page.evaluate(scraperFn);
  });
}

async function cleanup(): Promise<void> {
  if (!browserInstance) return;

  logger.info("Cerrando instancia global de Puppeteer...");
  try {
    const pages = await browserInstance.pages();
    await Promise.all(pages.map((p) => p.close({ runBeforeUnload: false }).catch(() => {})));
    await browserInstance.close();
  } catch (err) {
    logger.error("Error cerrando Puppeteer en el shutdown", { err });
    const proc = browserInstance.process();
    if (proc) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignorar
      }
    }
  }
  browserInstance = null;
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(0);
});

process.on("exit", () => {
  const proc = browserInstance?.process();
  if (proc) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignorar
    }
  }
});
