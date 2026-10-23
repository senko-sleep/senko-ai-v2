const https = require('https');
function get(url, cookie, cb) {
  https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.google.com/',
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {})
    }
  }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => cb(res.statusCode, res.headers.location, d, res.headers['content-type']));
  }).on('error', e => console.log('ERR', e.message));
}
const cookies = ['CONSENT=YES+cb', 'SOCS=CAESHAgBEhIAGgA'];
let hops = 0;
function follow(url) {
  hops++;
  if (hops > 5) { console.log('max hops'); return; }
  get(url, cookies.join('; '), (s, loc, d, ct) => {
    console.log(`hop ${hops}: STATUS ${s} LEN ${d.length} ct=${ct} loc=${loc ? loc.slice(0,50) : 'none'}`);
    if (s >= 300 && s < 400 && loc) {
      const dest = loc.startsWith('http') ? loc : 'https://www.google.com' + loc;
      follow(dest);
    } else {
      console.log('  AF_initDataCallback', /AF_initDataCallback/.test(d));
      const ou = /"ou":"(https?:\/\/[^"]+)"/g; let n=0,m; while((m=ou.exec(d))){n++;} console.log('  ou count', n);
      const ipr = /"ip":"(https?:\/\/[^"]+)"/g; let p=0,mm; while((mm=ipr.exec(d))){p++;} console.log('  ip count', p);
    }
  });
}
// pb param with the full image-spec the UI uses
const pb = encodeURIComponent('ic:1,isc:1,nc:1,o:1,si:1,st:1,ssp:1,scp:1,sc:1,ep:1');
follow('https://www.google.com/search?q=' + encodeURIComponent('cowgirl porn') + '&tbm=isch&hl=en&safe=off&udm=2&pb=' + pb);
setTimeout(() => process.exit(0), 20000);
