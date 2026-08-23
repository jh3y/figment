import { useEffect, useMemo, useState } from "react";
import type { ReviewMetadata } from "@figment/core";
import { Markdown } from "./Markdown";
import type { StudioData, StudioGeneration, StudioProject } from "./types";

type View = "gallery" | "brief" | "references" | "prototypes";
type ThemePreference = "system" | "light" | "dark";
type ReviewPatch = Partial<ReviewMetadata>;
type ReviewSaveState = "idle" | "saving" | "saved" | "error";

export default function App() {
  const [data, setData] = useState<StudioData>();
  const [error, setError] = useState<string>();
  const [projectId, setProjectId] = useState("all");
  const [view, setView] = useState<View>("gallery");
  const [selected, setSelected] = useState<number>();
  const [model, setModel] = useState("all");
  const [category, setCategory] = useState("all");
  const [batch, setBatch] = useState("all");
  const [review, setReview] = useState("all");
  const [tag, setTag] = useState("all");
  const [showRejected, setShowRejected] = useState(() => localStorage.getItem("figment-show-rejected") === "true");
  const [reviewSaves, setReviewSaves] = useState<Record<string, ReviewSaveState>>({});
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem("figment-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    if (theme === "system") media.addEventListener("change", apply);
    localStorage.setItem("figment-theme", theme);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => { void load(); }, []);
  useEffect(() => { localStorage.setItem("figment-show-rejected", String(showRejected)); }, [showRejected]);
  async function load() {
    try {
      for (const endpoint of ["/api/studio", "./studio-data.json"]) {
        const response = await fetch(endpoint);
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) continue;
        setData(await response.json() as StudioData);
        return;
      }
      throw new Error("Studio could not read the projects directory.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  const activeProject = data?.projects.find((project) => project.metadata.id === projectId);
  const visible = useMemo(() => (data?.generations ?? []).filter((item) => {
    const reviewValue = item.metadata.review;
    return (projectId === "all" || item.projectId === projectId)
      && (model === "all" || item.metadata.model === model)
      && (category === "all" || item.category === category)
      && (batch === "all" || item.batchName === batch)
      && (tag === "all" || item.metadata.review.tags.includes(tag))
      && (showRejected || review === "reject" || reviewValue.signal !== "reject")
      && (review === "all" || (review === "favourite" ? reviewValue.favourite : reviewValue.signal === review));
  }), [data, projectId, model, category, batch, review, tag, showRejected]);

  const models = unique((data?.generations ?? []).filter(inProject).map((item) => item.metadata.model));
  const categories = unique((data?.generations ?? []).filter(inProject).map((item) => item.category));
  const batches = unique((data?.generations ?? []).filter(inProject).map((item) => item.batchName));
  const tags = unique((data?.generations ?? []).filter(inProject).flatMap((item) => item.metadata.review.tags));
  function inProject(item: StudioGeneration) { return projectId === "all" || item.projectId === projectId; }

  async function patchReview(item: StudioGeneration, patch: ReviewPatch) {
    if (data?.readOnly) return;
    setReviewSaves((current) => ({ ...current, [item.metadataPath]: "saving" }));
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metadataPath: item.metadataPath, review: patch }) });
      if (!response.ok) throw new Error("Could not save review.");
      const metadata = await response.json() as StudioGeneration["metadata"];
      setData((current) => current && ({ ...current, generations: current.generations.map((candidate) => candidate.metadataPath === item.metadataPath ? { ...candidate, metadata } : candidate) }));
      setReviewSaves((current) => ({ ...current, [item.metadataPath]: "saved" }));
    } catch {
      setReviewSaves((current) => ({ ...current, [item.metadataPath]: "error" }));
    }
  }

  if (error) return <main className="state"><p className="eyebrow">Figment Studio</p><h1>Couldn’t open the lab.</h1><p>{error}</p></main>;
  if (!data) return <main className="state"><p className="eyebrow">Figment Studio</p><h1>Opening the lab…</h1></main>;

  return <div className={`shell ${data.readOnly ? "read-only" : ""}`}>
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" tabIndex={0} aria-label="Fig, the Figment mascot">
          <img className="brand-avatar brand-avatar-default" src="./fig-avatar.png" alt="" />
          <img className="brand-avatar brand-avatar-hover" src="./fig-avatar-hover.png" alt="" />
        </span>
        <span>Figment</span>
      </div>
      <button className={`project-row ${projectId === "all" ? "active" : ""}`} onClick={() => { setProjectId("all"); setView("gallery"); }}>
        <span>All work</span><small>{data.generations.length}</small>
      </button>
      {groupYears(data.projects).map(([year, projects]) => <section className="year" key={year}>
        <p>{year}</p>
        {projects.map((project) => <button className={`project-row ${projectId === project.metadata.id ? "active" : ""}`} key={project.metadata.id} onClick={() => { setProjectId(project.metadata.id); setView("gallery"); }}>
          <span>{project.metadata.title}</span><i className={`status ${project.metadata.status}`} />
        </button>)}
      </section>)}
      <ThemeControl value={theme} onChange={setTheme} />
      <div className="sidebar-note"><span>Filesystem live</span><small>Scanned {timeAgo(data.scannedAt)}</small></div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div><p className="eyebrow">{activeProject ? `${activeProject.year} / ${activeProject.metadata.status}` : "Creative archive"}</p><h1>{activeProject?.metadata.title ?? "All work"}</h1></div>
        <nav>
          {data.readOnly && <span className="snapshot-badge" title="This published build cannot write back to project files">Published snapshot</span>}
          <button className={view === "gallery" ? "active" : ""} onClick={() => setView("gallery")}>Gallery</button>
          {activeProject && <button className={view === "brief" ? "active" : ""} onClick={() => setView("brief")}>Brief</button>}
          {activeProject && <button className={view === "references" ? "active" : ""} onClick={() => setView("references")}>References</button>}
          {activeProject && <button className={view === "prototypes" ? "active" : ""} onClick={() => setView("prototypes")}>Prototypes</button>}
        </nav>
      </header>

      {view === "gallery" && <>
        <div className="filters">
          <Select label="Category" value={category} options={categories} onChange={setCategory} />
          <Select label="Model" value={model} options={models} onChange={setModel} />
          <Select label="Batch" value={batch} options={batches} onChange={setBatch} />
          <Select label="Review" value={review} options={["favourite", "shortlist", "reject", "unreviewed"]} onChange={setReview} />
          {tags.length > 0 && <Select label="Tag" value={tag} options={tags} onChange={setTag} />}
          <button className={`rejected-toggle ${showRejected ? "active" : ""}`} type="button" aria-pressed={showRejected} onClick={() => setShowRejected((current) => !current)}>{showRejected ? "Hide rejected" : "Show rejected"}</button>
          <span className="count">{visible.length} {visible.length === 1 ? "output" : "outputs"}</span>
        </div>
        {visible.length ? <div className="gallery">{visible.map((item, index) => <GalleryCard item={item} key={`${item.metadataPath}-${item.outputIndex}`} onOpen={() => setSelected(index)} onReview={(patch) => void patchReview(item, patch)} />)}</div>
          : <Empty hasProjects={data.projects.length > 0} />}
      </>}

      {activeProject && view === "brief" && <DocumentView project={activeProject} />}
      {activeProject && view === "references" && <References project={activeProject} />}
      {activeProject && view === "prototypes" && <Prototypes project={activeProject} />}
    </main>
    {selected !== undefined && visible[selected] && <Lightbox item={visible[selected]} position={selected} total={visible.length} saveState={reviewSaves[visible[selected]!.metadataPath] ?? "idle"} onClose={() => setSelected(undefined)} onMove={(step) => setSelected((selected + step + visible.length) % visible.length)} onReview={(patch) => void patchReview(visible[selected]!, patch)} />}
  </div>;
}

function GalleryCard({ item, onOpen, onReview }: { item: StudioGeneration; onOpen: () => void; onReview: (patch: ReviewPatch) => void }) {
  return <article className={`card ${item.metadata.review.signal === "reject" ? "rejected" : ""}`}>
    <button className="artwork" onClick={onOpen}><img src={item.imageUrl} alt={item.metadata.prompt} loading="lazy" /><span className="kind">{friendlyCategory(item.category)}</span><span className="shot-number">#{item.shotNumber}</span></button>
    <button className={`heart card-heart ${item.metadata.review.favourite ? "active" : ""}`} aria-label={`Favourite shot ${item.shotNumber}`} onClick={() => onReview(item.metadata.review.favourite ? clearDirection() : { favourite: true, signal: "unreviewed" })}>♥</button>
  </article>;
}

function Lightbox({ item, position, total, saveState, onClose, onMove, onReview }: { item: StudioGeneration; position: number; total: number; saveState: ReviewSaveState; onClose: () => void; onMove: (step: number) => void; onReview: (patch: ReviewPatch) => void }) {
  const [note, setNote] = useState(item.metadata.review.note ?? "");
  const [tags, setTags] = useState(item.metadata.review.tags.join(", "));
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "escape") onClose();
      else if (key === "arrowleft") onMove(-1);
      else if (key === "arrowright") onMove(1);
      else if (key === "1") onReview(item.metadata.review.favourite ? clearDirection() : { favourite: true, signal: "unreviewed" });
      else if (key === "2") onReview(item.metadata.review.signal === "shortlist" ? clearDirection() : { favourite: false, signal: "shortlist" });
      else if (key === "3") onReview(item.metadata.review.signal === "reject" ? clearDirection() : { favourite: false, signal: "reject" });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [item.metadata.review, onClose, onMove, onReview]);
  useEffect(() => { setNote(item.metadata.review.note ?? ""); setTags(item.metadata.review.tags.join(", ")); }, [item]);
  const cost = item.metadata.actualCost ?? item.metadata.estimatedCost;
  return <div className="lightbox" role="dialog" aria-modal="true">
    <button className="close" onClick={onClose}>Close <span>×</span></button>
    <button className="previous" aria-label="Previous image" title="Previous · Left arrow" onClick={() => onMove(-1)}>←</button>
    <div className="lightbox-art"><img src={item.imageUrl} alt={item.metadata.prompt} /></div>
    <button className="next" aria-label="Next image" title="Next · Right arrow" onClick={() => onMove(1)}>→</button>
    <aside className="details">
      <p className="eyebrow">Shot #{item.shotNumber} · {friendlyCategory(item.category)} · {position + 1} / {total}</p>
      <h2>{item.projectTitle}</h2>
      <div className="review-guide">
        <p>Choose one directional signal per image. Select it again to clear.</p>
        <p><strong>Favourite</strong> = strongest · <strong>Shortlist</strong> = develop · <strong>Reject</strong> = stop pursuing</p>
      </div>
      <div className="review-actions">
        <button className={`review-favourite ${item.metadata.review.favourite ? "active" : ""}`} onClick={() => onReview(item.metadata.review.favourite ? clearDirection() : { favourite: true, signal: "unreviewed" })}>♥ Favourite <kbd>1</kbd></button>
        <button className={`review-shortlist ${item.metadata.review.signal === "shortlist" ? "active" : ""}`} onClick={() => onReview(item.metadata.review.signal === "shortlist" ? clearDirection() : { favourite: false, signal: "shortlist" })}>Shortlist <kbd>2</kbd></button>
        <button className={`review-reject ${item.metadata.review.signal === "reject" ? "active" : ""}`} onClick={() => onReview(item.metadata.review.signal === "reject" ? clearDirection() : { favourite: false, signal: "reject" })}>Reject <kbd>3</kbd></button>
      </div>
      <p className={`review-save ${saveState}`} role="status" aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved to project files" : saveState === "error" ? "Couldn’t save — try again" : ""}</p>
      <Detail label="Prompt"><p className="prompt">{item.metadata.prompt}</p></Detail>
      <div className="facts"><Fact label="Model" value={item.metadata.model} /><Fact label="Cost" value={cost ? `${cost.kind === "estimate" ? "~" : ""}$${cost.amount.toFixed(3)}` : "Unknown"} /><Fact label="Created" value={new Date(item.metadata.createdAt).toLocaleString()} /><Fact label="Dimensions" value={dimensions(item.metadata)} /></div>
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
  const [selectedSlug, setSelectedSlug] = useState(project.prototypes.find((prototype) => prototype.launchUrl)?.slug ?? project.prototypes[0]?.slug);
  useEffect(() => { setSelectedSlug(project.prototypes.find((prototype) => prototype.launchUrl)?.slug ?? project.prototypes[0]?.slug); }, [project.metadata.id, project.prototypes]);
  const selected = project.prototypes.find((prototype) => prototype.slug === selectedSlug);
  if (!project.prototypes.length) return <div className="empty"><p className="eyebrow">Project prototypes</p><h2>No prototypes yet.</h2><p>Ask your agent to prototype a promising direction alongside this project's generated assets.</p></div>;
  return <div className="prototype-browser">
    <aside className="prototype-list">
      <div className="prototype-intro"><p className="eyebrow">Project experiments</p><p>Prototypes stay with the project and may use any suitable technology.</p></div>
      {project.prototypes.map((prototype) => <button className={selected?.slug === prototype.slug ? "active" : ""} key={prototype.slug} onClick={() => setSelectedSlug(prototype.slug)}>
        <span>{prototype.title.slice(0, 1).toUpperCase()}</span><div><strong>{prototype.title}</strong><small>{prototype.launchUrl ? prototype.kind === "static" ? "Static preview" : "Runnable prototype" : "Files only"}</small></div>
      </button>)}
    </aside>
    {selected && <section className="prototype-stage">
      <header><div><p className="eyebrow">{selected.kind} prototype</p><h2>{selected.title}</h2>{selected.description && <p>{selected.description}</p>}</div>{selected.launchUrl && <a href={selected.launchUrl} target="_blank" rel="noreferrer">Open in new tab ↗</a>}</header>
      {selected.launchUrl && selected.embeddable
        ? <iframe src={selected.launchUrl} title={`${selected.title} prototype`} sandbox="allow-scripts allow-forms allow-modals allow-popups" />
        : <div className="prototype-empty"><p>{selected.launchUrl ? "This prototype is configured to open separately." : "There isn’t a runnable preview yet."}</p><code>{selected.path}</code>{!selected.launchUrl && <small>Add an <strong>index.html</strong>, or a <strong>prototype.json</strong> pointing to its local development URL.</small>}</div>}
    </section>}
  </div>;
}

function ThemeControl({ value, onChange }: { value: ThemePreference; onChange: (value: ThemePreference) => void }) {
  const themes: Array<{ value: ThemePreference; icon: string; label: string }> = [
    { value: "light", icon: "☀", label: "Light theme" },
    { value: "dark", icon: "☾", label: "Dark theme" },
    { value: "system", icon: "◐", label: "Use system theme" },
  ];
  return <div className="theme-control" role="group" aria-label="Studio theme">{themes.map((theme) => <button key={theme.value} className={value === theme.value ? "active" : ""} aria-label={theme.label} title={theme.label} aria-pressed={value === theme.value} onClick={() => onChange(theme.value)}><span aria-hidden="true">{theme.icon}</span></button>)}</div>;
}

function Empty({ hasProjects }: { hasProjects: boolean }) { return <div className="empty"><p className="eyebrow">A quiet canvas</p><h2>{hasProjects ? "No outputs match this view." : "No projects yet."}</h2><p>{hasProjects ? "Adjust the filters or run a small probe." : "Projects will appear here as they are added to the filesystem."}</p>{hasProjects && <code>pnpm lab probe &lt;project&gt; …</code>}</div>; }
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
function friendlyCategory(category: string) { return category.replaceAll("-", " "); }
function dimensions(item: StudioGeneration["metadata"]) { return item.width && item.height ? `${item.width} × ${item.height}` : item.aspectRatio ?? item.resolution ?? "Unknown"; }
function clearDirection(): ReviewPatch { return { favourite: false, signal: "unreviewed" }; }
function timeAgo(value: string) { const seconds = Math.round((Date.now() - Date.parse(value)) / 1000); return seconds < 60 ? "just now" : `${Math.round(seconds / 60)}m ago`; }
