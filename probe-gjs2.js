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
const u = 'https://www.google.com/search?q=' + encodeURIComponent('cowgirl porn') + '&tbm=isch&hl=en&safe=off&udm=2';
get(u, cookies.join('; '), (s, loc, d) => {
  console.log('STATUS', s, 'LEN', d.length);
  console.log('has AF_initDataCallback', /AF_initDataCallback/.test(d));
  console.log('has imgurl', /imgurl=/.test(d), 'ou=', /"ou":/.test(d));
  const ou = /"ou":"(https?:\/\/[^"]+)"/g; let n=0,m; while((m=ou.exec(d))){n++; if(n<=3) console.log('  ou', m[1].slice(0,80));} console.log('ou: count', n);
  const re = /"((?:https?%3A%2F%2F|https?:)[^"\\]*?\.(?:jpg|jpeg|png|webp|gif))/gi; let c=0; while((re.exec(d))){c++;} console.log('image urls', c);
});
setTimeout(() => process.exit(0), 15000);
