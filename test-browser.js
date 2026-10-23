const puppeteer = require('puppeteer');
(async () => {
  try {
    const p = puppeteer.executablePath();
    console.log('executablePath:', p);
    const fs = require('fs');
    console.log('exists:', fs.existsSync(p));
  } catch (e) {
    console.log('err', e.message);
  }
})();
