# Image, dynamic UI, speed and API-efficiency audit

## Verdict

The workspace is **not yet reliable at producing a polished, image-rich interactive site instantly** with the tested configured models. Real browser acceptance tests found failures rather than accepting plausible code. The runtime can serve raster assets and execute dynamic browser behavior, but the live model runs did not deliver the requested gallery.

## Test contract and results

The opt-in live benchmark provided three real NASA/JPL images with their source metadata. It asked the coding agent to create a responsive gallery using plain HTML/CSS/JS, batching file writes. Acceptance required:

- Three decoded, visible images with meaningful alt text and suitable `object-fit`.
- Three columns at 1280px; one column at 390px; no horizontal overflow or overlapping images.
- A Mars filter that changes the actual rendered collection, and All restoring it.
- An Earth favorite whose state survives a reload.
- An accessible Earth details dialog dismissed by Escape.
- No uncaught browser exceptions.

The independent Playwright evaluator runs after generation, without asking another model to judge whether buttons work. A separately labelled controlled fixture validates the evaluator: real raster layout and dynamic behavior pass; a missing image and a filter that only changes a heading fail. That fixture is not presented as model-generated work.

| Live model | First file saved | Inference HTTP requests | Coding execution | Actual outcome |
| --- | --- | --- | --- | --- |
| Groq GPT-OSS 120B | No file | 1 | 14.0s | Incomplete; provider token capacity/rate-limit recovery prevented completion. |
| Cloudflare Llama 3.2 3B | No file | 3 | 9.3s | Incomplete; repeatedly unusable tool JSON. |
| Groq GPT-OSS 20B | 6.7s | 2 | Stopped at 90.0s | Files created, but the page crashed before rendering image cards. All eight browser acceptance checks failed. |

These are single runs, not a statistical model ranking. The 20B attempt made three model-function calls but only two inference HTTP requests: waiting for quota did not send another request. Its independent browser evaluation originally added about 37 seconds, including a 30-second missing-element wait. The evaluator now uses a two-second default locator timeout; this change is covered by regression tests and does not change that failed run's recorded timing.

The retained 20B desktop/mobile screenshots show a heading and two filter buttons, with no gallery. Its script reads a nonexistent `#image-sources` element, producing `Cannot read properties of null (reading 'textContent')`. It also mismatches dialog IDs. The result fails the visual rubric for task relevance, completeness, image composition and usable interaction. There is no numerical creativity score and no claim that the design is excellent.

## Fixes made from the audit

1. **Binary image handling:** JPEGs and other binary assets were previously decoded as UTF-8 and included in text context. Assets now appear in the file inventory without raw binary content in the coding prompt. Larger image assets can be inventoried within the existing resource bound. Text editing of binary assets is disabled in the workspace.
2. **Checkpoint integrity:** Binary files are saved as base64 in checkpoints and restored byte-for-byte. A regression test covers exact restoration and absence of image bytes from model text context. Existing text checkpoints remain compatible.
3. **Hard inference budget:** A server coding workflow defaults to at most **24 actual inference HTTP requests**, configurable by its server caller; the benchmark uses **8**. Generation and the wrapper's repair phase share the same budget. It covers steps, fallback, input-size retries and compatibility retries. Tests prove that exhaustion cannot send another request. Model-discovery GETs and research/asset GETs are separate; the live artifact records those Node fetches without credentials.
4. **No speculative coding hedges:** Coding calls disable parallel backup requests. Provider failover remains available within the budget.
5. **Stop unproductive reads:** Three identical read-only batches against the same unchanged revision stop the loop with files preserved. Successful reads now explicitly say the full file is in the next context, rather than reporting “No operations.”
6. **Research reuse:** Identical successful research within 60 seconds reuses its actual result and original provenance. Failed lookups are not cached. Sources are deduplicated. A test proves two identical fetch operations make one network request.
7. **Automatic static-page smoke check:** After a static HTML/CSS/JS edit batch, the runtime can inspect it directly and include real browser errors in the next coding context without an extra inference round trip to request the inspection. This applies to simple static projects; it does not certify all requested behaviors. A regression test exercises an actual null-element crash.
8. **Measured execution:** Task journals record model calls, inference HTTP attempts, request cap, tool operations, research cache hits, time to first file, and total coding duration. Per-attempt response-header latency is named `responseHeadersMs`; older retained runs' attempt `durationMs` fields also measured headers, not complete generation time. No token or dollar cost is fabricated.

## Evidence and reproduction

- `artifacts/image-ui-quality/result.json`: final 120B/Cloudflare run, provenance and network records.
- `artifacts/image-ui-quality/before-binary-fix.json`: earlier failed baseline; kept separately.
- `artifacts/image-ui-quality/groq-20b/result.json`: complete smaller-model attempt and eight failing browser checks.
- `artifacts/image-ui-quality/groq-20b/groq-{desktop,mobile}.png`: actual generated output.
- `artifacts/image-ui-quality/groq-20b/groq-source/`: untouched generated HTML/CSS/JS for diagnosis.
- `artifacts/image-ui-regression.log`: actual regression output.

Validation: the full offline suite passed **598 tests across 48 files**. After the final workflow-budget wiring, the affected coding, full-stack, UI-quality and routing integration suites passed **20 tests across four files**. TypeScript, targeted ESLint, and the production build passed, exit 0. Full build output is retained in `artifacts/image-ui-build.log`.

```powershell
npx vitest run --maxWorkers=1
npx tsc --noEmit
npx vitest run --config vitest.live.config.ts src/__live__/coding-ui-quality.live.test.ts

# A single exact model, without silently benchmarking fallback:
$env:QUALITY_BENCHMARK_PROVIDER='groq'
$env:QUALITY_BENCHMARK_MODEL='openai/gpt-oss-20b'
$env:QUALITY_BENCHMARK_LABEL='groq-20b'
npx vitest run --config vitest.live.config.ts src/__live__/coding-ui-quality.live.test.ts
```

## Limits of this result

The harness stages the photos from NASA's public image API; it does not prove autonomous image selection, licensing assessment, generation, or visual understanding. The coding loop still supplies text/source context rather than image pixels to its coding model. Browser acceptance uses the runtime's real HTTP server; image resolution inside the separate workspace `srcdoc` preview was not certified by this gallery test. The initial broad NASA “Mars” search returned an event photo, so staging was corrected to a specific verified planetary image ID before the final comparison. Asset metadata matters as well as whether an image URL loads.

The 15-second first-file target and 90-second coding deadline are explicit benchmark targets, not promises of instant completion. Asset preparation and post-run acceptance are outside the coding timer. Existing provider quota and output quality remain limiting factors. Single-process request budgets do not constitute global billing limits or a durable cross-process job-deduplication system; deliberately resuming starts a new execution budget. The older stateless browser `/api/code/step` path is not a server workflow and does not share this task-wide budget. Arbitrary authentication flows, animation quality, full accessibility conformance, and every possible dynamic application were not certified by this gallery contract.
