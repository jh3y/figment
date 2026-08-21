import { useEffect, useMemo, useState } from "react";
import type { ReviewMetadata } from "@figment/core";
import { Markdown } from "./Markdown";
import type { StudioData, StudioGeneration, StudioProject } from "./types";

type View = "gallery" | "brief" | "references" | "prototypes";

export default function App() {
  const [data, setData] = useState<StudioData>();
  const [error, setError] = useState<string>();
  const [projectId, setProjectId] = useState("all");
  const [view, setView] = useState<View>("gallery");
  const [selected, setSelected] = useState<number>();
  const [model, setModel] = useState("all");
  const [batch, setBatch] = useState("all");
  const [review, setReview] = useState("all");
  const [tag, setTag] = useState("all");

  useEffect(() => { void load(); }, []);
  async function load() {
    try {
      const response = await fetch("/api/studio");
      if (!response.ok) throw new Error("Studio could not read the projects directory.");
      setData(await response.json() as StudioData);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  const activeProject = data?.projects.find((project) => project.metadata.id === projectId);
  const visible = useMemo(() => (data?.generations ?? []).filter((item) => {
    const reviewValue = item.metadata.review;
    return (projectId === "all" || item.projectId === projectId)
      && (model === "all" || item.metadata.model === model)
      && (batch === "all" || item.batchName === batch)
      && (tag === "all" || item.metadata.review.tags.includes(tag))
      && (review === "all" || (review === "favourite" ? reviewValue.favourite : reviewValue.signal === review));
  }), [data, projectId, model, batch, review, tag]);

  const models = unique((data?.generations ?? []).filter(inProject).map((item) => item.metadata.model));
  const batches = unique((data?.generations ?? []).filter(inProject).map((item) => item.batchName));
  const tags = unique((data?.generations ?? []).filter(inProject).flatMap((item) => item.metadata.review.tags));
  function inProject(item: StudioGeneration) { return projectId === "all" || item.projectId === projectId; }

  async function patchReview(item: StudioGeneration, patch: Partial<ReviewMetadata>) {
    const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metadataPath: item.metadataPath, review: patch }) });
    if (!response.ok) throw new Error("Could not save review.");
    const metadata = await response.json() as StudioGeneration["metadata"];
    setData((current) => current && ({ ...current, generations: current.generations.map((candidate) => candidate.metadataPath === item.metadataPath ? { ...candidate, metadata } : candidate) }));
  }

  if (error) return <main className="state"><p className="eyebrow">Figment Studio</p><h1>Couldn’t open the lab.</h1><p>{error}</p></main>;
  if (!data) return <main className="state"><p className="eyebrow">Figment Studio</p><h1>Opening the lab…</h1></main>;

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">F</span><span>Figment</span></div>
      <button className={`project-row ${projectId === "all" ? "active" : ""}`} onClick={() => { setProjectId("all"); setView("gallery"); }}>
        <span>All work</span><small>{data.generations.length}</small>
      </button>
      {groupYears(data.projects).map(([year, projects]) => <section className="year" key={year}>
        <p>{year}</p>
        {projects.map((project) => <button className={`project-row ${projectId === project.metadata.id ? "active" : ""}`} key={project.metadata.id} onClick={() => { setProjectId(project.metadata.id); setView("gallery"); }}>
          <span>{project.metadata.title}</span><i className={`status ${project.metadata.status}`} />
        </button>)}
      </section>)}
      <div className="sidebar-note"><span>Filesystem live</span><small>Scanned {timeAgo(data.scannedAt)}</small></div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div><p className="eyebrow">{activeProject ? `${activeProject.year} / ${activeProject.metadata.status}` : "Creative archive"}</p><h1>{activeProject?.metadata.title ?? "All work"}</h1></div>
        <nav>
          <button className={view === "gallery" ? "active" : ""} onClick={() => setView("gallery")}>Gallery</button>
          {activeProject && <button className={view === "brief" ? "active" : ""} onClick={() => setView("brief")}>Brief</button>}
          {activeProject && <button className={view === "references" ? "active" : ""} onClick={() => setView("references")}>References</button>}
          {activeProject && <button className={view === "prototypes" ? "active" : ""} onClick={() => setView("prototypes")}>Prototypes</button>}
        </nav>
      </header>

      {view === "gallery" && <>
        <div className="filters">
          <Select label="Model" value={model} options={models} onChange={setModel} />
          <Select label="Batch" value={batch} options={batches} onChange={setBatch} />
          <Select label="Review" value={review} options={["favourite", "shortlist", "reject", "unreviewed"]} onChange={setReview} />
          {tags.length > 0 && <Select label="Tag" value={tag} options={tags} onChange={setTag} />}
          <span className="count">{visible.length} {visible.length === 1 ? "output" : "outputs"}</span>
        </div>
        {visible.length ? <div className="gallery">{visible.map((item, index) => <GalleryCard item={item} key={`${item.metadataPath}-${item.outputIndex}`} onOpen={() => setSelected(index)} onReview={(patch) => void patchReview(item, patch)} />)}</div>
          : <Empty hasProjects={data.projects.length > 0} />}
      </>}

      {activeProject && view === "brief" && <DocumentView project={activeProject} />}
      {activeProject && view === "references" && <References project={activeProject} />}
      {activeProject && view === "prototypes" && <Prototypes project={activeProject} />}
    </main>
    {selected !== undefined && visible[selected] && <Lightbox item={visible[selected]} position={selected} total={visible.length} onClose={() => setSelected(undefined)} onMove={(step) => setSelected((selected + step + visible.length) % visible.length)} onReview={(patch) => void patchReview(visible[selected]!, patch)} />}
  </div>;
}

function GalleryCard({ item, onOpen, onReview }: { item: StudioGeneration; onOpen: () => void; onReview: (patch: Partial<ReviewMetadata>) => void }) {
  return <article className="card">
    <button className="artwork" onClick={onOpen}><img src={item.imageUrl} alt={item.metadata.prompt} loading="lazy" /><span className="kind">{item.kind}</span></button>
    <div className="card-meta"><div><strong>{item.projectTitle}</strong><span>{friendlyModel(item.metadata.model)}</span></div><button className={`heart ${item.metadata.review.favourite ? "active" : ""}`} aria-label="Favourite" onClick={() => onReview({ favourite: !item.metadata.review.favourite })}>♥</button></div>
  </article>;
}

function Lightbox({ item, position, total, onClose, onMove, onReview }: { item: StudioGeneration; position: number; total: number; onClose: () => void; onMove: (step: number) => void; onReview: (patch: Partial<ReviewMetadata>) => void }) {
  const [note, setNote] = useState(item.metadata.review.note ?? "");
  const [tags, setTags] = useState(item.metadata.review.tags.join(", "));
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); if (event.key === "ArrowLeft") onMove(-1); if (event.key === "ArrowRight") onMove(1); };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [onClose, onMove]);
  useEffect(() => { setNote(item.metadata.review.note ?? ""); setTags(item.metadata.review.tags.join(", ")); }, [item]);
  const cost = item.metadata.actualCost ?? item.metadata.estimatedCost;
  return <div className="lightbox" role="dialog" aria-modal="true">
    <button className="close" onClick={onClose}>Close <span>×</span></button>
    <button className="previous" aria-label="Previous image" onClick={() => onMove(-1)}>←</button>
    <div className="lightbox-art"><img src={item.imageUrl} alt={item.metadata.prompt} /></div>
    <button className="next" aria-label="Next image" onClick={() => onMove(1)}>→</button>
    <aside className="details">
      <p className="eyebrow">{position + 1} / {total} · {item.kind}</p>
      <h2>{item.projectTitle}</h2>
      <div className="review-actions">
        <button className={item.metadata.review.favourite ? "active" : ""} onClick={() => onReview({ favourite: !item.metadata.review.favourite })}>♥ Favourite</button>
        {(["shortlist", "reject"] as const).map((signal) => <button key={signal} className={item.metadata.review.signal === signal ? "active" : ""} onClick={() => onReview({ signal: item.metadata.review.signal === signal ? "unreviewed" : signal })}>{signal}</button>)}
      </div>
      <Detail label="Prompt"><p className="prompt">{item.metadata.prompt}</p></Detail>
      <div className="facts"><Fact label="Model" value={item.metadata.model} /><Fact label="Cost" value={cost ? `${cost.kind === "estimate" ? "~" : ""}$${cost.amount.toFixed(3)}` : "Unknown"} /><Fact label="Created" value={new Date(item.metadata.createdAt).toLocaleString()} /><Fact label="Dimensions" value={dimensions(item.metadata)} /></div>
      <Detail label="Rating"><div className="rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={item.metadata.review.rating === value ? "active" : ""} aria-label={`Rate ${value} out of 5`} onClick={() => onReview({ rating: value })}>{value}</button>)}</div></Detail>
      <Detail label="Review note"><textarea value={note} placeholder="What works? What needs to change?" onChange={(event) => setNote(event.target.value)} onBlur={() => onReview({ note })} /></Detail>
      <Detail label="Tags"><input value={tags} placeholder="expressive, face, warm" onChange={(event) => setTags(event.target.value)} onBlur={() => onReview({ tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) })} /></Detail>
      {item.metadata.references.length > 0 && <Detail label="References">{item.metadata.references.map((reference) => <code key={reference.localPath}>{reference.localPath}</code>)}</Detail>}
      {item.metadata.parentGenerationId && <Detail label="Lineage"><p>Derived from {item.metadata.parentGenerationId}</p></Detail>}
      <details><summary>Parameters & provenance</summary><pre>{JSON.stringify({ batch: item.batchName, jobId: item.metadata.jobId, parameters: item.metadata.parameters, provider: item.metadata.provider }, null, 2)}</pre></details>
    </aside>
  </div>;
}

function DocumentView({ project }: { project: StudioProject }) {
  const [tab, setTab] = useState<"brief" | "decisions">("brief");
  return <div className="document-wrap"><div className="document-tabs"><button className={tab === "brief" ? "active" : ""} onClick={() => setTab("brief")}>Creative brief</button><button className={tab === "decisions" ? "active" : ""} onClick={() => setTab("decisions")}>Decision history</button></div><Markdown source={project[tab]} /></div>;
}

function References({ project }: { project: StudioProject }) {
  return project.references.length ? <div className="reference-grid">{project.references.map((reference) => <figure key={reference.path}><img src={reference.url} alt={reference.name} /><figcaption>{reference.name}</figcaption></figure>)}</div> : <div className="empty"><p className="eyebrow">Reference library</p><h2>No references yet.</h2><p>Place original images in <code>projects/{project.year}/{project.metadata.slug}/references/</code>. Figment will never modify them.</p></div>;
}

function Prototypes({ project }: { project: StudioProject }) {
  return project.prototypes.length ? <div className="prototype-list">{project.prototypes.map((name) => <div key={name}><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name.replaceAll("-", " ")}</strong><code>projects/{project.year}/{project.metadata.slug}/prototypes/{name}</code></div></div>)}</div> : <div className="empty"><p className="eyebrow">Project prototypes</p><h2>No prototypes yet.</h2><p>Ask your agent to prototype a promising direction alongside this project's generated assets.</p></div>;
}

function Empty({ hasProjects }: { hasProjects: boolean }) { return <div className="empty"><p className="eyebrow">A quiet canvas</p><h2>{hasProjects ? "No outputs match this view." : "Start with a conversation."}</h2><p>{hasProjects ? "Adjust the filters or run a small probe." : "Ask your agent to start a new project, shape the brief, then test one focused visual question."}</p><code>{hasProjects ? "pnpm lab probe <project> …" : "Start a new project."}</code></div>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="all">All</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
function Detail({ label, children }: { label: string; children: React.ReactNode }) { return <section className="detail-section"><h3>{label}</h3>{children}</section>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function unique(items: string[]) { return [...new Set(items)].sort(); }
function groupYears(projects: StudioProject[]): Array<[number, StudioProject[]]> {
  const years = new Map<number, StudioProject[]>();
  for (const project of projects) years.set(project.year, [...(years.get(project.year) ?? []), project]);
  return [...years.entries()];
}
function friendlyModel(model: string) { return model.split("/").at(-1)?.replaceAll("-", " ") ?? model; }
function dimensions(item: StudioGeneration["metadata"]) { return item.width && item.height ? `${item.width} × ${item.height}` : item.aspectRatio ?? item.resolution ?? "Unknown"; }
function timeAgo(value: string) { const seconds = Math.round((Date.now() - Date.parse(value)) / 1000); return seconds < 60 ? "just now" : `${Math.round(seconds / 60)}m ago`; }
