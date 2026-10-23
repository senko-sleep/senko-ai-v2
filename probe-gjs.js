const https = require('https');
function get(url, cookie, cb) {
  https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.google.com/',
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {})
    }
  }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => cb(res.statusCode, res.headers.location, d));
  }).on('error', e => console.log('ERR', e.message));
}
const cookies = ['CONSENT=YES+cb', 'SOCS=CAESHAgBEhIAGgA'];
// Google's image-results JSON endpoint (the XHR the Images UI fires)
const u = 'https://www.google.com/search?q=' + encodeURIComponent('cowgirl porn') + '&tbm=isch&hl=en&safe=off&pb=' +
  encodeURIComponent('ic:1,isc:1,nc:1,o:1,si:1,st:1,ssp:1,scp:1');
get(u, cookies.join('; '), (s, loc, d) => {
  console.log('STATUS', s, 'LOC', loc, 'LEN', d.length);
  console.log('has AF_initDataCallback', /AF_initDataCallback/.test(d));
  console.log('has imgurl', /imgurl=/.test(d), 'ou=', /[?&]ou=/.test(d));
  console.log('blocked?', /unusual traffic|CAPTCHA|before you continue|accept all|consent/i.test(d));
  // count image-looking URLs in JSON
  const re = /"((?:https?%3A%2F%2F|https?:)[^"\\]*?\.(?:jpg|jpeg|png|webp|gif))/gi;
  let m, c = 0; while ((m = re.exec(d))) c++;
  console.log('image urls in JSON', c);
  // also try iu=/ou= style
  const ou = /"ou":"(https?:\/\/[^"]+)"/g; let n=0; while((n,mm=ou.exec(d))){n++;} console.log('ou: count', n);
});
setTimeout(() => process.exit(0), 15000);
