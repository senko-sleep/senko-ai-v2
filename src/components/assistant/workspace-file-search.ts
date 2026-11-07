export function filterWorkspacePaths(paths: string[], query: string): string[] {
  const needle = query.trim().toLowerCase().replace(/\\/g, "/");
  return paths.filter((path) => path.toLowerCase().includes(needle)).sort((a, b) => {
    const aName = a.split("/").pop()!.toLowerCase(), bName = b.split("/").pop()!.toLowerCase();
    return Number(bName.startsWith(needle)) - Number(aName.startsWith(needle)) || a.localeCompare(b);
  });
}
