const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setViewport({ width: 128, height: 128 });

    const htmlPath = 'file:///' + path.resolve(__dirname, 'icon-render.html').replace(/\\/g, '/');
    await page.goto(htmlPath);

    await page.screenshot({
        path: path.join(__dirname, 'icon.png'),
        omitBackground: true,
        clip: { x: 0, y: 0, width: 128, height: 128 }
    });

    console.log('Icon saved to icon.png');
    await browser.close();
})();
