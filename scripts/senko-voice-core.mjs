import init from "@echogarden/espeak-ng-emscripten";
import { createHash } from "node:crypto";

export const SENKO_RENDERER_VERSION = "1.1.0";

export function selectMood(emotion = "") {
  const mood = emotion.toLowerCase();
  if (/sleep|eepy|tired/.test(mood)) return "sleepy";
  if (/sass|smug|teas|proud/.test(mood)) return "sassy";
  if (/excit|happy|playful|giddy|hyp|energetic|joy/.test(mood)) return "excited";
  if (/soft|calm|cozy|gentle|sad|mellow|intimate/.test(mood)) return "soft";
  return "neutral";
}

export function compileVoicebank(bank, mood = "neutral") {
  if (bank.kind !== "authored-formant-voicebank" || bank.id !== "senko-formant-v1" || !bank.moods[mood]) throw new Error("Unsupported Senko voicebank");
  const weights = bank.moods[mood];
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > .001 || Object.values(weights).some(w => w < 0)) throw new Error("Voice layer weights must be normalized");
  const blend = key => Object.entries(weights).reduce((sum, [layer, weight]) => sum + bank.layers[layer][key] * weight, 0);
  const breath = Array.from({ length: 8 }, (_, i) => Math.round(Object.entries(weights).reduce((sum, [layer, weight]) => sum + bank.layers[layer].breath[i] * weight, 0)));
  const variant = [
    "language variant", "name Senko", "gender female",
    `pitch ${bank.pitch.map(n => Math.round(n * blend("pitchScale"))).join(" ")}`,
    ...bank.formants.map(f => `formant ${f.join(" ")}`),
    `tone ${bank.tone.join(" ")}`, `consonants ${bank.consonants.join(" ")}`,
    `stressAmp ${bank.stressAmplitude.join(" ")}`,
    `voicing ${Math.round(blend("voicing"))}`, `breath ${breath.join(" ")}`,
    "breathw 100 120 140 160 180 200 200 200", "roughness 0", "flutter 2", "words 0 1",
  ].join("\n") + "\n";
  return { variant, rate: blend("rate"), range: blend("range"), mood, fingerprint: createHash("sha256").update(JSON.stringify({ bank, renderer: SENKO_RENDERER_VERSION })).digest("hex").slice(0, 16) };
}

export function pcmWav(chunks, sampleRate = 22050) {
  const length = chunks.reduce((sum, c) => sum + c.length, 0);
  const raw = new Float64Array(length);
  let offset = 0, previousInput = 0, previousOutput = 0, peak = 1;
  for (const chunk of chunks) for (const input of chunk) {
    const output = input - previousInput + .995 * previousOutput; // DC rejection, no pitch shifting.
    raw[offset++] = output; previousInput = input; previousOutput = output;
    peak = Math.max(peak, Math.abs(output));
  }
  const buffer = Buffer.alloc(44 + length * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(length * 2, 40);
  const gain = Math.min(1.5, 27000 / peak);
  for (let i = 0; i < raw.length; i++) buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(raw[i] * gain))), 44 + i * 2);
  return buffer;
}

/** Trusted performance instructions are authored here; user text is always XML-escaped. */
export function buildPerformance(text, mood) {
  const normalized = text.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
  const spoken = /[.!?]["']?$/.test(normalized) ? normalized : `${normalized}.`;
  const segments = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(spoken)].map(item => item.segment.trim()).filter(Boolean);
  const phrases = segments.map((sentence, index) => {
    const question = /\?["']?$/.test(sentence);
    const pitch = question ? (mood === "excited" ? 54 : 52) : index === segments.length - 1 && segments.length > 1 ? 49 : 50;
    const rate = question ? 98 : index === 0 ? 100 : index === segments.length - 1 ? 98 : 101;
    const volume = mood === "soft" || mood === "sleepy" ? "-1dB" : "medium";
    const escaped = sentence.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return { sentence, pitch, rate, volume, markup: `<s><prosody pitch="${pitch}" rate="${rate}%" volume="${volume}">${escaped}</prosody></s>` };
  });
  return { markup: `<speak>${phrases.map(phrase => phrase.markup).join('<break time="80ms"/>')}</speak>`, phrases };
}

export async function synthesizeSenko({ text, emotion, bank, maxSeconds = 1200 }) {
  if (typeof text !== "string" || !text.trim() || text.length > 15000) throw new Error("Senko voice input must contain 1–15000 characters");
  const model = compileVoicebank(bank, selectMood(emotion));
  const engineModule = await init();
  const synth = new engineModule.eSpeakNGWorker();
  const chunks = [];
  let samples = 0;
  try {
    engineModule.FS.writeFile("/usr/share/espeak-ng-data/voices/!v/senko", model.variant);
    synth.set_voice(`${bank.language}+senko`);
    // The Emscripten binding uses native eSpeak units, not multiplier values.
    synth.set_rate(Math.round(175 * model.rate));
    synth.set_pitch(50);
    synth.set_range(Math.round(50 * model.range));
    const performance = buildPerformance(text, model.mood);
    synth.synthesize(performance.markup, chunk => {
      if (chunk?.length) { chunks.push(chunk.slice()); samples += chunk.length; }
      return samples > (maxSeconds + .1) * 22050; // Interrupt synthesis before large allocations.
    });
    if (samples > (maxSeconds + .05) * 22050) throw new Error("Senko speech exceeds the selected duration limit");
    if (samples < 2205) throw new Error("Senko voice produced no speech");
    return { audio: pcmWav(chunks), mime: "audio/wav", seconds: samples / 22050, model: bank.id, fingerprint: model.fingerprint, mood: model.mood, voice: "Senko (designed synthetic voice)" };
  } finally { synth.__destroy__(); }
}
