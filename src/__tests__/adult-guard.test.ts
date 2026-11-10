import { describe, it, expect } from "vitest";
import { adultSubject, checkAdultImageRequest } from "@/lib/server/adult-guard";
import { detectCollageRequest } from "@/lib/server/images";
import type { EntityDossier } from "@/lib/server/entity-dossier";

function dossier(over: Partial<EntityDossier>): EntityDossier {
  return { query: "", title: "", summary: "", text: "", sections: [], trivia: [], facts: [], images: [], related: [], sources: [], snippets: [], ...over };
}
const research = (map: Record<string, EntityDossier>) => async (name: string) => map[name.toLowerCase()] || null;

describe("adult image requests", () => {
  it("ordinary requests are not checked", async () => {
    expect(await checkAdultImageRequest("anya forger", async () => { throw new Error("should not research"); })).toEqual({ allowed: true });
  });

  it("blocks minor characters (stated age under 18)", async () => {
    const r = await checkAdultImageRequest("nsfw anya forger", research({ "anya forger": dossier({ title: "Anya Forger", description: "Fictional character from Spy × Family", fandom: { host: "x", title: "Anya Forger" }, facts: [{ label: "Age", value: "6 (Forged I.D. papers), 5", source: "" }] }) }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("minor");
  });

  it("blocks words that describe minors without any research", async () => {
    const r = await checkAdultImageRequest("hentai schoolgirl", async () => null);
    expect(r.allowed).toBe(false);
  });

  it("blocks real, identifiable people", async () => {
    const r = await checkAdultImageRequest("nude taylor swift", research({ "taylor swift": dossier({ title: "Taylor Swift", description: "American singer-songwriter (born 1989)", facts: [{ label: "born", value: "13 December 1989", source: "" }] }) }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("real person");
  });

  it("allows adult fictional characters", async () => {
    const r = await checkAdultImageRequest("nsfw yor forger", research({ "yor forger": dossier({ title: "Yor Forger", description: "Fictional character from Spy × Family", fandom: { host: "x", title: "Yor Forger" }, facts: [{ label: "Age", value: "27", source: "" }] }) }));
    expect(r).toMatchObject({ allowed: true, subject: "Yor Forger" });
  });

  it("parses adult collage requests and keeps the subject clean", () => {
    expect(detectCollageRequest("make an nsfw collage of Yor Forger")).toMatchObject({ query: "Yor Forger", adultWord: "nsfw" });
    expect(detectCollageRequest("make a hentai collage of Yor Forger")).toMatchObject({ query: "Yor Forger", adultWord: "hentai" });
    expect(detectCollageRequest("make a collage of Yor Forger")?.adultWord).toBeUndefined();
    expect(adultSubject("nsfw pics of yor forger")).toBe("yor forger");
  });
});
