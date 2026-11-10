// Grounding artifacts only. No Pokemon layout or facts are hardcoded into production rendering.
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve("artifacts/dynamic-ui");
const publicRoot = path.resolve("public/test-fixtures/ui-generation");
await fs.mkdir(path.join(root, "sources"), { recursive: true });
await fs.mkdir(path.join(publicRoot, "assets"), { recursive: true });
async function resource(url) {
  const cache = path.join(root, "sources", Buffer.from(url).toString("base64url") + ".json");
  try { return JSON.parse(await fs.readFile(cache, "utf8")); } catch { /* first fetch */ }
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const value = await response.json(); await fs.writeFile(cache, JSON.stringify(value)); return value;
}
const pokemon = await resource("https://pokeapi.co/api/v2/pokemon/eevee");
const species = await resource(pokemon.species.url);
const chain = await resource(species.evolution_chain.url);
const branches = chain.chain.evolves_to;
if (branches.length !== 8) throw new Error("The acceptance source did not return eight Eevee evolutions.");
const entities = [];
for (const entry of [{ species: pokemon.species, evolution_details: [] }, ...branches]) {
  const data = entry.species.name === "eevee" ? pokemon : await resource(`https://pokeapi.co/api/v2/pokemon/${entry.species.name}`);
  const imageUrl = data.sprites.other["official-artwork"].front_default;
  const target = path.join(publicRoot, "assets", `${data.id}.png`);
  try { await fs.access(target); } catch {
    const image = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!image.ok || !image.headers.get("content-type")?.startsWith("image/")) throw new Error(`Artwork unavailable: ${imageUrl}`);
    await fs.writeFile(target, Buffer.from(await image.arrayBuffer()));
  }
  entities.push({ name: data.name, id: data.id, types: data.types.map((type) => type.type.name), heightMetres: data.height / 10, weightKg: data.weight / 10,
    abilities: data.abilities.map((ability) => ({ name: ability.ability.name, hidden: ability.is_hidden })),
    evolutionMethods: entry.evolution_details.map((details) => Object.fromEntries(Object.entries(details).filter(([, value]) => value !== null && value !== false && value !== ""))),
    sourceUrl: `https://pokeapi.co/api/v2/pokemon/${data.name}`, imageSourceUrl: imageUrl,
    imageUrl: `http://localhost:3000/test-fixtures/ui-generation/assets/${data.id}.png` });
}
const result = { source: "PokeAPI pokemon, species and evolution-chain resources; exact image URLs returned in sprites.other.official-artwork", retrievedAt: new Date().toISOString(),
  species: species.genera.find((value) => value.language.name === "en")?.genus,
  description: species.flavor_text_entries.filter((value) => value.language.name === "en").at(-1)?.flavor_text.replace(/[\n\f]/g, " "),
  evolutionVersionNote: "Source lists alternate conditions across game versions; do not present every alternative as simultaneously required.", entities };
await fs.writeFile(path.join(root, "source-data.json"), JSON.stringify(result, null, 2));
await fs.writeFile(path.join(publicRoot, "source-data.json"), JSON.stringify(result, null, 2));
console.log(`Prepared ${entities.length} actual Pokemon artwork files and source records.`);
