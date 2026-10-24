const fs = require("fs");
const path = require("path");
const dir = "src/app/prompts";
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".txt"))) {
  const text = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n?/g, "\n");
  const esc = text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const out = `// Prompt text (edit freely). A plain module, so no bundler loader is needed.\nexport default \`${esc}\`;\n`;
  const m = {};
  new Function("m", out.replace(/^\/\/.*\n/, "").replace("export default", "m.v ="))(m);
  if (m.v !== text) throw new Error("round-trip mismatch in " + f);
  fs.writeFileSync(path.join(dir, f.replace(/\.txt$/, ".ts")), out);
  fs.unlinkSync(path.join(dir, f));
  console.log("converted", f);
}
