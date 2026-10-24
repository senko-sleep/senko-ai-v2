// Offline benchmark of the real screencast producer and LiveView, without an LLM,
// database, external websites, or changes to the running application's sessions.
// Usage: node scripts/profile-browser.mjs [report.json]
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const out = path.resolve(process.argv[2] || "test-results/browser-performance/current.json");
const temp = path.resolve("node_modules/.cache/browser-profile");
if (path.dirname(temp) !== path.resolve("node_modules/.cache")) throw new Error("Invalid benchmark cache directory");
const ref = process.argv.find(a => a.startsWith("--ref="))?.slice(6);
const originalFiles = ["src/lib/agent/sessions.ts", "src/components/assistant/live-view.tsx"];
const originalSource = ref ? Object.fromEntries(originalFiles.map(file => [path.resolve(file), execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" })])) : {};
const historicalSource = { name: "historical-source", setup(builder) {
  builder.onLoad({filter:/\.(ts|tsx)$/}, args => originalSource[args.path] === undefined ? undefined : { contents:originalSource[args.path], loader:args.path.endsWith("tsx")?"tsx":"ts" });
} };
await mkdir(temp, { recursive: true });
await build({ stdin:{ contents:`export {BrowserSession} from './src/lib/agent/sessions'; export {createLiveStream} from './src/lib/server/live-stream';`, resolveDir:process.cwd(), loader:"ts" }, outfile: `${temp}/sessions.cjs`, bundle: true, platform: "node", packages: "external", format: "cjs", logLevel: "silent", plugins:[historicalSource] });
const { BrowserSession, createLiveStream } = createRequire(import.meta.url)(`${temp}/sessions.cjs`);
const bundle = await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {LiveView, createLiveBus} from './src/components/assistant/live-view';
    import {createInputChannel} from './src/lib/live-input';
    const bus = createLiveBus();
    window.bus = bus;
    window.hasFrame = false;
    window.inputs = [];
    let legacyQueue=[],busy=false;
    const send=async(events,signal)=>{
      const r=await fetch('/input',{method:'POST',body:JSON.stringify({events}),signal});
      if(!r.ok)throw new Error('input failed');
    };
    const inputChannel=${ref ? `{
      push(e){legacyQueue.push(e);pump()}
    };
    async function pump(){if(busy)return;busy=true;try{while(legacyQueue.length)await send([legacyQueue.shift()])}finally{busy=false}}` : `createInputChannel(send,e=>{window.inputError=String(e)})`};
    createRoot(document.getElementById('root')).render(React.createElement(LiveView, {
      bus, title: 'Performance fixture', agentRunning: true, interactive: true,
      onHasFrame: v => window.hasFrame = v,
      onInput: e => {window.inputs.push({...e, at: performance.now()});inputChannel.push(e)}
    }));
    const events = new EventSource('/events');
    window.events=events;
    events.onmessage = e => {const frame=JSON.parse(e.data);if(frame.type==='frame'){window.lastFrameReceived=performance.now();window.lastFrameSent=frame.sentAt;}bus.emit(frame)};
  `, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, minify: true, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", plugins:[historicalSource],
});
let session;
let captures = 0;
let inputRequests = 0;
const source = `<!doctype html><style>body{margin:0;height:20000px;background:linear-gradient(#123,#a45);font:24px sans-serif}#motion{position:fixed;width:80px;height:80px;background:coral;top:100px}input{position:fixed;top:20px}</style><input aria-label="Text"><div id="motion"></div><script>
window.wheels=[];addEventListener('wheel',e=>wheels.push({at:performance.now(),dy:e.deltaY}));
window.animate=true;function tick(t){if(animate)document.querySelector('#motion').style.transform='translateX('+(640+Math.sin(t/200)*550)+'px)';requestAnimationFrame(tick)}requestAnimationFrame(tick);
</script>`;
const server = createServer(async (req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/source") res.end(source);
  else if (req.url === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const annotate = e => { if(e.type === "frame") { captures++; return {...e,sentAt:Date.now()}; } return e; };
    if (ref) {
      const unsub = session.subscribe(e => res.write(`data: ${JSON.stringify(annotate(e))}\n\n`));
      req.on("close", unsub);
    } else {
      const abort=new AbortController();req.on('close',()=>abort.abort());
      const stream=createLiveStream(send=>session.subscribe(e=>send(annotate(e))),abort.signal);
      const reader=stream.getReader();
      try { for(;;) {const {done,value}=await reader.read();if(done)break;if(!res.write(value))await new Promise(resolve=>res.once('drain',resolve));} } catch {} finally {await reader.cancel();res.end();}
    }
  } else if(req.url === '/input') {
    inputRequests++;
    let body='';for await(const chunk of req)body+=chunk;
    const {events}=JSON.parse(body);
    // Controlled 60 ms round trip, in addition to actual CDP execution time.
    await new Promise(r=>setTimeout(r,30));
    try {
      if(session.inputBatch)await session.inputBatch(events);
      else for(const event of events)await session.input(event);
      await new Promise(r=>setTimeout(r,30));res.end('{}');
    } catch(e) {res.statusCode=500;res.end(String(e));}
  } else res.end(`<!doctype html><style>html,body,#root{margin:0;width:100%;height:100%;background:black}#root>div{position:absolute;inset:0}canvas{position:absolute;inset:0;width:100%;height:100%}.pointer-events-none{pointer-events:none}.sk-agent-cursor,.sk-target-box{position:absolute;top:0;left:0}</style><div id="root"></div><script>
    window.stats={raf:0,draws:[],longTasks:[],decodeMs:[],receiveToPaintMs:[],transportToPaintMs:[]};
    const decoded=new WeakMap();
    const decode=window.createImageBitmap;
    window.createImageBitmap=async(...args)=>{const start=performance.now(),received=window.lastFrameReceived,sent=window.lastFrameSent;const image=await decode(...args);stats.decodeMs.push(performance.now()-start);decoded.set(image,{received,sent});return image;};
    const raf=window.requestAnimationFrame;window.requestAnimationFrame=fn=>raf(t=>{stats.raf++;fn(t)});
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(...args){const now=performance.now();stats.draws.push(now);const t=decoded.get(args[0]);if(t){stats.receiveToPaintMs.push(now-t.received);stats.transportToPaintMs.push(Date.now()-t.sent);}return draw.apply(this,args)};
    new PerformanceObserver(l=>stats.longTasks.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});
    </script><script src="/bundle.js"></script>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const channels=process.env.PROFILE_BROWSER_CHANNEL?[process.env.PROFILE_BROWSER_CHANNEL]:['chromium','chrome','msedge'];
  let launchError;
  for(const channel of channels) {
    try {browser=await chromium.launch({headless:true,channel});break;}catch(error){launchError=error;}
  }
  if(!browser)throw launchError;
  const remote = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await remote.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`${base}/source`);
  session = new BrowserSession("profile", "profile");
  session.context = remote; session.pages = [page]; session.status = "active"; session.takeover = true;
  const viewer = await browser.newPage({ viewport: { width: 960, height: 600 } });
  viewer.setDefaultTimeout(10_000);
  await viewer.goto(base);
  await viewer.waitForFunction(() => window.hasFrame);
  await viewer.waitForTimeout(400);
  captures = 0;
  await viewer.evaluate(() => { stats.raf=0; stats.draws=[]; stats.longTasks=[];stats.decodeMs=[];stats.receiveToPaintMs=[];stats.transportToPaintMs=[]; });
  const started = performance.now();
  await viewer.waitForTimeout(3000);
  const elapsed = performance.now() - started;
  const motion = await viewer.evaluate(() => structuredClone(stats));
  const captureFps = captures * 1000 / elapsed;
  await page.evaluate(() => window.animate = false);
  await viewer.waitForTimeout(300);
  await viewer.evaluate(() => { stats.raf=0; stats.draws=[]; });
  await viewer.waitForTimeout(1000);
  const idle = await viewer.evaluate(() => ({ raf:stats.raf,draws:stats.draws.length }));
  // Type through the actual LiveView key handlers while the source is animating.
  await page.evaluate(() => window.animate=true);
  await viewer.mouse.click(75,25);
  await page.waitForFunction(()=>document.activeElement?.tagName==='INPUT');
  await viewer.waitForTimeout(100);
  inputRequests=0;
  const typingStart=performance.now();
  await viewer.keyboard.type('abcdefghijklmnopqrst');
  await page.waitForFunction(()=>document.querySelector('input').value==='abcdefghijklmnopqrst');
  const typingBurstMs=performance.now()-typingStart;
  const typingRequests=inputRequests;
  // Exercise drag capture and IME through the same input transport (new viewer only).
  let interactions;
  if (!ref) {
    await page.evaluate(() => {
      window.drag=[];
      addEventListener('mousedown',e=>drag.push({type:'down',x:e.clientX,y:e.clientY}));
      addEventListener('mousemove',e=>{if(e.buttons)drag.push({type:'move',x:e.clientX,y:e.clientY})});
      addEventListener('mouseup',e=>drag.push({type:'up',x:e.clientX,y:e.clientY}));
    });
    await viewer.mouse.move(150,150);await viewer.mouse.down();
    await viewer.mouse.move(360,300,{steps:8});await viewer.mouse.up();
    await page.waitForFunction(()=>window.drag.some(e=>e.type==='up'));
    const drag=await page.evaluate(()=>window.drag);
    if(drag[0]?.type!=='down'||drag.at(-1)?.type!=='up'||!drag.some(e=>e.type==='move'))throw new Error('Drag input did not reach the browser');
    await viewer.mouse.click(75,25);
    await viewer.evaluate(()=>document.querySelector('[role=application]').dispatchEvent(new CompositionEvent('compositionend',{data:'日本語',bubbles:true})));
    await page.waitForFunction(()=>document.querySelector('input').value.includes('日本語'));
    const dimsBefore=await viewer.evaluate(()=>({w:document.querySelector('canvas').width,h:document.querySelector('canvas').height}));
    await viewer.setViewportSize({width:720,height:450});
    await viewer.waitForFunction(()=>document.querySelector('canvas').width===720);
    const dimsAfter=await viewer.evaluate(()=>({w:document.querySelector('canvas').width,h:document.querySelector('canvas').height}));
    await viewer.setViewportSize({width:960,height:600});
    await viewer.waitForFunction(()=>document.querySelector('canvas').width===960);
    interactions={dragCommands:drag.length,ime:true,resize:{before:dimsBefore,after:dimsAfter}};
  }
  await page.evaluate(() => window.animate=false);
  await page.evaluate(() => window.wheels = []);
  const scrollStart = performance.now();
  await session.input({type:"wheel",dx:0,dy:800,x:500,y:400});
  await page.waitForFunction(() => window.wheels.reduce((n,e)=>n+e.dy,0)>=799);
  const scrollCompleteMs = performance.now() - scrollStart;
  const wheels = await page.evaluate(() => window.wheels);
  // Stop the live source so a genuinely new frame cannot invalidate the reset test.
  await viewer.evaluate(()=>window.events.close());
  await viewer.waitForTimeout(300);
  // A deterministic slow decode exposes stale paints after a reset.
  const resetRace = await viewer.evaluate(async () => {
    const visible = document.querySelector('canvas');
    const before = visible.toDataURL();
    const c=document.createElement('canvas');c.width=1280;c.height=800;
    const source=c.getContext('2d');source.fillStyle='#ff00aa';source.fillRect(0,0,c.width,c.height);
    const data=c.toDataURL('image/jpeg').split(',')[1];
    const original=window.createImageBitmap;
    window.createImageBitmap=async (...a)=>{await new Promise(r=>setTimeout(r,100));return original(...a)};
    bus.emit({type:'frame',data,width:1280,height:800});
    bus.emit({type:'reset'});
    await new Promise(r=>setTimeout(r,160));
    window.createImageBitmap=original;
    return {staleFrameAfterReset:visible.toDataURL()!==before};
  });
  const gaps=motion.draws.slice(1).map((t,i)=>t-motion.draws[i]).sort((a,b)=>a-b);
  const percentile=(values,p)=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted[Math.floor(sorted.length*p)];};
  const report={
    at:new Date().toISOString(),revision:ref||'working-tree',browser:browser.version(),durationMs:elapsed,
    captureFps,paintFps:motion.draws.length*1000/elapsed,
    paintGapP50Ms:gaps[Math.floor(gaps.length*.5)],paintGapP95Ms:gaps[Math.floor(gaps.length*.95)],
    longTasks:motion.longTasks, idleRafCallbacksPerSecond:idle.raf,idleDrawsPerSecond:idle.draws,
    decodeP95Ms:percentile(motion.decodeMs,.95),receiveToPaintP95Ms:percentile(motion.receiveToPaintMs,.95),transportToPaintP95Ms:percentile(motion.transportToPaintMs,.95),
    typingBurstMs,typingRequests,simulatedInputRttMs:60,
    interactions,
    scrollCompleteMs,scrollCommands:wheels.length,...resetRace,
    note:"Local headless Chromium, 1280x800 source, 960x600 viewer; excludes WAN/LLM latency. Refresh rate and screencast encoder limit actual FPS."
  };
  await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  if(process.argv.includes('--serve')) {
    await page.evaluate(()=>{window.scrollTo(0,0);window.animate=true;document.querySelector('input').value='';});
    console.log(`Inspect live viewer: ${base}`);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }
} finally {
  await session?.stopCast(); await browser?.close(); server.closeAllConnections(); server.close();
  await rm(temp,{recursive:true,force:true});
}
