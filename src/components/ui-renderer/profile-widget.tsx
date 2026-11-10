// Encyclopedia-style profile: one deliberate structure for every subject.
//   Hero (portrait, identity, quote, lead, headline stats)
//   Overview | Story | Connections | Gallery
//   Sources
import { useEffect, useMemo, useState } from "react";
import type { UINode } from "@/lib/ui-schema";
import { resolveImageQuery, SmartImage } from "./smart-image";
import "./profile-widget.css";

type Profile = Extract<UINode, { type: "profile" }>;
type Tab = "overview" | "story" | "connections" | "gallery";
type Person = NonNullable<Profile["relationships"]>[number];

const REL_GROUPS: { name: string; test: RegExp }[] = [
  { name: "Family", test: /father|mother|parent|son\b|daughter|brother|sister|sibling|uncle|aunt|cousin|grand|wife|husband|spouse|family|pet|niece|nephew|adoptive|child|ex-wife|ex-husband/i },
  { name: "Friends & allies", test: /friend|ally|allies|classmate|partner|colleague|mentor|teacher|student|collaborator|companion|crush|admirer|acquaintance|advisor|teammate/i },
  { name: "Rivals & foes", test: /rival|enemy|foe|nemesis|antagonist|adversary|target|opponent/i },
];

function groupPeople(people: Person[]) {
  const out = new Map<string, Person[]>();
  for (const p of people) {
    const g = REL_GROUPS.find((x) => x.test.test(`${p.role || ""} ${p.description || ""}`))?.name || "Other";
    if (!out.has(g)) out.set(g, []);
    out.get(g)!.push(p);
  }
  return [...REL_GROUPS.map((g) => g.name), "Other"].filter((g) => out.has(g)).map((g) => ({ group: g, people: out.get(g)! }));
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Plain article text → paragraphs, bullet lists and small subheadings. */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="pf-prose">
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.every((l) => l.startsWith("•"))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{l.replace(/^•\s*/, "")}</li>)}</ul>;
        return lines.map((line, j) =>
          line.length <= 48 && /:$/.test(line)
            ? <h5 key={`${i}-${j}`}>{line.replace(/:$/, "")}</h5>
            : line.startsWith("•") ? <ul key={`${i}-${j}`}><li>{line.replace(/^•\s*/, "")}</li></ul>
            : <p key={`${i}-${j}`}>{line}</p>);
      })}
    </div>
  );
}

/**
 * A person's picture. Verified images from the server come first; cards saved before the
 * server verified images (or that it couldn't verify) fall back to an image search, trying
 * candidates until one loads, and only then show initials.
 */
function Portrait({ name, imageUrl, query, size = "md" }: { name: string; imageUrl?: string; query?: string; size?: "md" | "lg" }) {
  const [found, setFound] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const candidates = imageUrl ? [imageUrl, ...found] : found;
  const current = candidates[index];
  useEffect(() => {
    if (imageUrl || !query) return;
    let live = true;
    void resolveImageQuery(query).then((list) => { if (live) setFound(list.slice(0, 6).map((c) => c.url)); });
    return () => { live = false; };
  }, [imageUrl, query]);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span className={`pf-portrait pf-portrait-${size}`} aria-hidden>
      {current
        // eslint-disable-next-line @next/next/no-img-element -- small portrait; server-verified when available
        ? <img key={current} src={current} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setIndex((i) => i + 1)} />
        : <span className="pf-initials">{initials}</span>}
    </span>
  );
}

function PersonCard({ person, onAsk, size, series }: { person: Person; onAsk?: (p: Person) => void; size?: "md" | "lg"; series?: string }) {
  return (
    <button type="button" className="pf-person" onClick={onAsk ? () => onAsk(person) : undefined} disabled={!onAsk} title={onAsk ? `Ask about ${person.name}` : person.name}>
      <Portrait name={person.name} imageUrl={person.imageUrl} query={person.imageQuery || `${person.name} ${series || ""}`.trim()} size={size} />
      <span className="pf-person-text">
        <span className="pf-person-name">{person.name}</span>
        {person.role && <span className="pf-person-role">{person.role}</span>}
        {person.description && <span className="pf-person-desc">{person.description}</span>}
      </span>
    </button>
  );
}

export function ProfileWidget({ node, onSendMessage }: { node: Profile; onSendMessage?: (prompt: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [shot, setShot] = useState(0);
  const [section, setSection] = useState(0);
  const [allTrivia, setAllTrivia] = useState(false);

  const pictures = useMemo(() => {
    const list = [{ title: node.name, imageUrl: node.imageUrl, imageQuery: node.imageQuery }];
    for (const g of node.gallery || []) if (g.imageUrl || g.imageQuery) list.push({ title: g.title || node.name, imageUrl: g.imageUrl, imageQuery: g.imageQuery });
    return list;
  }, [node.name, node.imageUrl, node.imageQuery, node.gallery]);
  const hero = pictures[Math.min(shot, pictures.length - 1)];
  const gallery = pictures.slice(1);
  const people = node.relationships || [];
  const sections = node.sections || [];
  const story = [...sections, ...(node.appearances?.length ? [{ title: "Key moments", body: node.appearances.map((a) => `• ${a.title}${a.subtitle ? ` (${a.subtitle})` : ""}${a.description ? ` — ${a.description}` : ""}`).join("\n") }] : [])];
  const facts = node.facts?.length ? node.facts : node.attributes?.length ? [{ group: "Details", items: node.attributes.map((a) => ({ label: a.label, value: String(a.value) })) }] : [];
  const ask = onSendMessage ? (p: Person) => onSendMessage(`Tell me about ${p.name}${node.series ? ` from ${node.series}` : ""} and their relationship with ${node.name}.`) : undefined;
  const subtitle = node.subtitle && node.subtitle !== node.series ? node.subtitle : undefined;
  const trivia = node.trivia || [];

  const tabs: { key: Tab; label: string; count?: number }[] = [{ key: "overview", label: "Overview" }];
  if (story.length) tabs.push({ key: "story", label: "Story", count: story.length });
  if (people.length) tabs.push({ key: "connections", label: "Connections", count: people.length });
  if (gallery.length) tabs.push({ key: "gallery", label: "Gallery", count: gallery.length });

  const openSection = (i: number) => { setSection(i); setTab("story"); };

  return (
    <article className="sk-ui-profile pf">
      {/* ── Hero ── */}
      <header className="pf-hero">
        {hero?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- decorative backdrop of the verified portrait
          <img className="pf-backdrop" src={hero.imageUrl} alt="" aria-hidden />
        )}
        <div className="pf-hero-art">
          <div className="pf-hero-frame">
            <SmartImage imageUrl={hero?.imageUrl} imageQuery={hero?.imageQuery} alt={hero?.title || node.name} aspect="portrait" eager className="!rounded-none !border-0" />
          </div>
          {gallery.length > 0 && (
            <div className="pf-thumbs" role="group" aria-label="Pictures">
              {pictures.slice(0, 5).map((p, i) => (
                <button key={i} type="button" className="pf-thumb" aria-pressed={shot === i} aria-label={`Show ${p.title}`} onClick={() => setShot(i)}>
                  {p.imageUrl
                    // eslint-disable-next-line @next/next/no-img-element -- verified app-hosted image
                    ? <img src={p.imageUrl} alt="" loading="lazy" />
                    : <span className="pf-initials">{i + 1}</span>}
                </button>
              ))}
              {pictures.length > 5 && <button type="button" className="pf-thumb pf-thumb-more" onClick={() => setTab("gallery")}>+{pictures.length - 5}</button>}
            </div>
          )}
        </div>

        <div className="pf-hero-text">
          {(node.series || node.category) && <div className="pf-eyebrow">{[node.series, node.category].filter(Boolean).join(" · ")}</div>}
          <h3 className="pf-name sk-ui-profile-title">{node.name}</h3>
          {(node.nativeName || subtitle) && <div className="pf-sub">{[subtitle, node.nativeName].filter(Boolean).join("  ·  ")}</div>}
          {node.aliases?.length ? <div className="pf-aliases"><span>Also known as</span> {node.aliases.slice(0, 5).join(" · ")}</div> : null}
          {node.bio && <p className="pf-lead">{node.bio}</p>}
          {node.highlights?.length ? (
            <dl className="pf-highlights">
              {node.highlights.map((h, i) => <div key={i}><dt>{h.label}</dt><dd>{h.value}</dd></div>)}
            </dl>
          ) : null}
          {node.quote && <blockquote className="pf-quote">{node.quote}</blockquote>}
          {node.badges?.length ? <div className="pf-badges">{node.badges.map((b, i) => <span key={i}>{b}</span>)}</div> : null}
        </div>
      </header>

      {/* ── Tabs ── */}
      {tabs.length > 1 && (
        <nav className="pf-tabs" role="tablist" aria-label={`${node.name} sections`}>
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}{t.count !== undefined && <span>{t.count}</span>}
            </button>
          ))}
        </nav>
      )}

      <div className="pf-body">
        {tab === "overview" && (
          <div className={`pf-overview${facts.length ? "" : " pf-overview-single"}`}>
            <div className="pf-main">
              {story.length > 0 && (
                <section>
                  <h4>At a glance</h4>
                  <div className="pf-chapters">
                    {story.slice(0, 4).map((s, i) => (
                      <button key={i} type="button" className="pf-chapter" onClick={() => openSection(i)}>
                        <span className="pf-chapter-title">{s.title}</span>
                        <span className="pf-chapter-text">{s.body.replace(/^•\s*/, "").split(/(?<=[.!?])\s/)[0].slice(0, 170)}</span>
                        <span className="pf-chapter-more">Read →</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {node.traits?.length ? (
                <section>
                  <h4>Personality</h4>
                  <div className="pf-chips">{node.traits.map((t, i) => <span key={i} title={t.description}>{t.name}</span>)}</div>
                </section>
              ) : null}

              {node.abilities?.length ? (
                <section>
                  <h4>Abilities & strengths</h4>
                  <ul className="pf-list">
                    {node.abilities.map((a, i) => <li key={i}><strong>{a.name}</strong>{a.description && <span> — {a.description}</span>}</li>)}
                  </ul>
                </section>
              ) : null}

              {people.length > 0 && (
                <section>
                  <div className="pf-section-head"><h4>Connections</h4>{people.length > 6 && <button type="button" onClick={() => setTab("connections")}>All {people.length} →</button>}</div>
                  <div className="pf-people">{people.slice(0, 6).map((p, i) => <PersonCard key={i} person={p} onAsk={ask} series={node.series} />)}</div>
                </section>
              )}

              {trivia.length > 0 && (
                <section>
                  <h4>Did you know?</h4>
                  <ul className="pf-trivia">{(allTrivia ? trivia : trivia.slice(0, 3)).map((t, i) => <li key={i}>{t}</li>)}</ul>
                  {trivia.length > 3 && <button type="button" className="pf-link" onClick={() => setAllTrivia((v) => !v)}>{allTrivia ? "Show less" : `Show all ${trivia.length}`}</button>}
                </section>
              )}
            </div>

            {facts.length > 0 && (
              <aside className="pf-infobox" aria-label="Facts">
                {facts.map((g, i) => (
                  <div key={i} className="pf-facts">
                    <h5>{g.group}</h5>
                    <dl>{g.items.map((f, j) => <div key={j}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
                  </div>
                ))}
              </aside>
            )}
          </div>
        )}

        {tab === "story" && story.length > 0 && (
          <div className="pf-story">
            <nav className="pf-toc" aria-label="Story sections">
              {story.map((s, i) => <button key={i} type="button" aria-current={section === i} onClick={() => setSection(i)}>{s.title}</button>)}
            </nav>
            <div className="pf-article">
              <h4>{story[section]?.title}</h4>
              <Prose text={story[section]?.body || ""} />
              <div className="pf-pager">
                {section > 0 ? <button type="button" onClick={() => setSection(section - 1)}>← {story[section - 1].title}</button> : <span />}
                {section < story.length - 1 && <button type="button" onClick={() => setSection(section + 1)}>{story[section + 1].title} →</button>}
              </div>
            </div>
          </div>
        )}

        {tab === "connections" && (
          <div className="pf-groups">
            {groupPeople(people).map((g) => (
              <section key={g.group}>
                <h4>{g.group}</h4>
                <div className="pf-people pf-people-lg">{g.people.map((p, i) => <PersonCard key={i} person={p} onAsk={ask} size="lg" series={node.series} />)}</div>
              </section>
            ))}
          </div>
        )}

        {tab === "gallery" && (
          <div className="pf-gallery">
            {gallery.map((g, i) => (
              <figure key={i}>
                <SmartImage imageUrl={g.imageUrl} imageQuery={g.imageQuery} alt={g.title || node.name} aspect="natural" quietActions />
                {g.title && <figcaption>{g.title}</figcaption>}
              </figure>
            ))}
          </div>
        )}
      </div>

      {node.sources?.length ? (
        <footer className="pf-sources">
          <span>Sources</span>
          {node.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noopener noreferrer">{s.label || hostOf(s.url)}</a>)}
        </footer>
      ) : null}
    </article>
  );
}
