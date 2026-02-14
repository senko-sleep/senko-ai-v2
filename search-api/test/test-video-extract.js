/**
 * Test script for video extraction from rule34video.com
 * Tests both /video-extract and /browse endpoints
 * 
 * Usage: node test/test-video-extract.js
 */

const BASE = "http://localhost:3010";
const TEST_URL = "https://rule34video.com/video/3117211/zaviel-compilation";

async function testEndpoint(endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const fullUrl = `${BASE}${endpoint}?${qs}`;
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Testing: ${endpoint}`);
  console.log(`URL: ${fullUrl}`);
  console.log(`${"=".repeat(80)}\n`);

  const start = Date.now();
  try {
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(120000) });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const data = await res.json();

    console.log(`Status: ${res.status} (${elapsed}s)`);
    console.log(`Title: ${data.title || data.meta?.title || "N/A"}`);

    if (data.videos && data.videos.length > 0) {
      console.log(`\n✅ Found ${data.videos.length} videos:`);
      data.videos.forEach((v, i) => {
        const isCdn = /\b(boomio|remote_control|cdn\d*[-.]prem)\b/i.test(v.url);
        const isGetFile = /\/get_file\//i.test(v.url);
        const tag = isCdn ? "🟢 CDN" : isGetFile ? "🟡 GET_FILE" : "⚪ OTHER";
        console.log(`  [${i}] ${tag} | source:${v.source || "?"} | type:${v.type || "?"} | quality:${v.quality || "?"}`);
        console.log(`       ${v.url.slice(0, 200)}`);
      });

      // Test if the top video URL is actually accessible
      const topVideo = data.videos[0];
      console.log(`\n🔍 Testing top video URL accessibility...`);
      try {
        const headRes = await fetch(topVideo.url, {
          method: "HEAD",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Referer": "https://rule34video.com/",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(10000),
        });
        console.log(`  HEAD response: ${headRes.status} ${headRes.statusText}`);
        console.log(`  Content-Type: ${headRes.headers.get("content-type") || "N/A"}`);
        console.log(`  Content-Length: ${headRes.headers.get("content-length") || "N/A"}`);
        if (headRes.ok) {
          console.log(`  ✅ VIDEO IS ACCESSIBLE!`);
        } else {
          console.log(`  ❌ VIDEO IS NOT ACCESSIBLE (${headRes.status})`);
        }
      } catch (e) {
        console.log(`  ❌ HEAD request failed: ${e.message}`);
      }

      // Also test through the video-proxy
      console.log(`\n🔍 Testing through video-proxy...`);
      try {
        const proxyUrl = `${BASE}/video-proxy?url=${encodeURIComponent(topVideo.url)}`;
        const proxyRes = await fetch(proxyUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(10000),
        });
        console.log(`  Proxy HEAD response: ${proxyRes.status} ${proxyRes.statusText}`);
        console.log(`  Content-Type: ${proxyRes.headers.get("content-type") || "N/A"}`);
        console.log(`  Content-Length: ${proxyRes.headers.get("content-length") || "N/A"}`);
        if (proxyRes.ok) {
          console.log(`  ✅ PROXY VIDEO IS ACCESSIBLE!`);
        } else {
          console.log(`  ❌ PROXY VIDEO FAILED (${proxyRes.status})`);
        }
      } catch (e) {
        console.log(`  ❌ Proxy request failed: ${e.message}`);
      }
    } else {
      console.log(`\n❌ No videos found!`);
      if (data.error) console.log(`Error: ${data.error}`);
    }

    return data;
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`❌ Request failed after ${elapsed}s: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log(`\n🎬 Rule34Video Extraction Test`);
  console.log(`Target: ${TEST_URL}`);
  console.log(`Server: ${BASE}\n`);

  // Check server health first
  try {
    const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (health.ok) {
      console.log(`✅ Server is running`);
    } else {
      console.log(`❌ Server returned ${health.status}`);
      process.exit(1);
    }
  } catch {
    console.log(`❌ Server is not running at ${BASE}`);
    console.log(`   Start it with: cd search-api && node server.js`);
    process.exit(1);
  }

  // Test 1: Static /url endpoint (should find flashvars URLs)
  console.log(`\n\n${"#".repeat(80)}`);
  console.log(`# TEST 1: Static /url endpoint`);
  console.log(`${"#".repeat(80)}`);
  await testEndpoint("/url", { url: TEST_URL, maxContent: "2000" });

  // Test 2: Puppeteer /browse endpoint
  console.log(`\n\n${"#".repeat(80)}`);
  console.log(`# TEST 2: Puppeteer /browse endpoint`);
  console.log(`${"#".repeat(80)}`);
  await testEndpoint("/browse", { url: TEST_URL, maxContent: "2000" });

  // Test 3: Dedicated /video-extract endpoint
  console.log(`\n\n${"#".repeat(80)}`);
  console.log(`# TEST 3: Dedicated /video-extract endpoint`);
  console.log(`${"#".repeat(80)}`);
  await testEndpoint("/video-extract", { url: TEST_URL });

  console.log(`\n\n${"=".repeat(80)}`);
  console.log(`Tests complete!`);
  console.log(`${"=".repeat(80)}\n`);
}

main().catch(console.error);
