/**
 * Diagnóstico: corre esto DESDE TU RED REAL (no desde un servidor cloud/CI)
 * para saber si AnimeFLV sirve datos de video o si el mirror www3/www4 los
 * tiene deshabilitados para todos. Uso: node scripts/check-animeflv-video.js
 */
const puppeteer = require("puppeteer");

const TEST_URLS = [
  "https://www3.animeflv.net/ver/naruto-1",
  "https://www3.animeflv.net/ver/kaguyasama-wa-kokurasetai-ultra-romantic-13",
];

async function check(url) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  const result = await page.evaluate(() => {
    const box = document.querySelector("#video_box");
    return box ? box.textContent.trim().slice(0, 200) : "NO_VIDEO_BOX_FOUND";
  });

  await browser.close();
  console.log(`${url}\n  -> ${result}\n`);
}

(async () => {
  for (const url of TEST_URLS) {
    await check(url);
  }
})();
