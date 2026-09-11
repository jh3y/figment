import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectStatus, ReviewMetadata } from "@figment/core";
import { Markdown } from "./Markdown";
import type { StudioActivity, StudioData, StudioGeneration, StudioProject } from "./types";

type View = "gallery" | "brief" | "references" | "prototypes";
type ThemePreference = "system" | "light" | "dark";
type ReviewPatch = Partial<ReviewMetadata>;
type ReviewSaveState = "idle" | "saving" | "saved" | "error";
interface StudioPreferences { projectId: string; view: View; model: string; category: string; batch: string; review: string; tag: string; showRejected: boolean }
const STUDIO_PREFERENCES_KEY = "figment-studio-preferences-v1";

export default function App() {
  const preferences = useMemo(readStudioPreferences, []);
  const [data, setData] = useState<StudioData>();
  const [error, setError] = useState<string>();
  const [projectId, setProjectId] = useState(preferences.projectId ?? "all");
  const [view, setView] = useState<View>(preferences.view ?? "gallery");
  const [selected, setSelected] = useState<number>();
  const [lightboxItems, setLightboxItems] = useState<StudioGeneration[]>([]);
  const [model, setModel] = useState(preferences.model ?? "all");
  const [category, setCategory] = useState(preferences.category ?? "all");
  const [batch, setBatch] = useState(preferences.batch ?? "all");
  const [review, setReview] = useState(preferences.review ?? "all");
  const [tag, setTag] = useState(preferences.tag ?? "all");
  const [showRejected, setShowRejected] = useState(preferences.showRejected ?? localStorage.getItem("figment-show-rejected") === "true");
  const [reviewSaves, setReviewSaves] = useState<Record<string, ReviewSaveState>>({});
  const [projectSave, setProjectSave] = useState<ReviewSaveState>("idle");
  const [liveActivity, setLiveActivity] = useState<StudioActivity>();
  const [refreshing, setRefreshing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const refreshingRef = useRef(false);
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
  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;
    const handler = (value: StudioActivity) => setLiveActivity(value);
    hot.on("figment:activity", handler);
    return () => hot.off("figment:activity", handler);
  }, []);
  useEffect(() => {
    localStorage.setItem(STUDIO_PREFERENCES_KEY, JSON.stringify({ projectId, view, model, category, batch, review, tag, showRejected } satisfies StudioPreferences));
  }, [projectId, view, model, category, batch, review, tag, showRejected]);
  useEffect(() => {
    if (!data) return;
    if (projectId === "all") { if (view !== "gallery") setView("gallery"); return; }
    if (!data.projects.some((project) => project.metadata.id === projectId)) { setProjectId("all"); setView("gallery"); }
  }, [data, projectId, view]);
  useEffect(() => { setProjectSave("idle"); }, [projectId]);
  useEffect(() => { setSidebarOpen(false); }, [projectId, view]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [sidebarOpen]);
  async function fetchStudioData(): Promise<StudioData> {
    for (const endpoint of ["/api/studio", "./studio-data.json"]) {
      const response = await fetch(endpoint);
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) continue;
      return await response.json() as StudioData;
    }
    throw new Error("Studio could not read the projects directory.");
  }

  function applyStudioData(next: StudioData) {
    setData(next);
    // A change landing while the snapshot was being read has to survive it, or its pending marker is lost.
    setLiveActivity((current) => current?.changedAt && next.activity && current.changedAt > next.scannedAt
      ? { ...next.activity, changedAt: current.changedAt }
      : next.activity);
  }

  async function load() {
    try { applyStudioData(await fetchStudioData()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  // A refresh swaps the snapshot in place, so the view, scroll position, and open image all survive it.
  async function refresh() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try { applyStudioData(await fetchStudioData()); }
    catch { /* Studio keeps the last good snapshot and tries again on the next change. */ }
    finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  const activity = liveActivity ?? data?.activity;
  const generating = Boolean(activity?.generating);
  const pendingOutputs = data && activity ? Math.max(0, activity.outputs - data.generations.length) : 0;
  const staleSnapshot = Boolean(data && activity?.changedAt && activity.changedAt > data.scannedAt);
  // Work arriving while nothing is generating is folded in quietly; a live run is held until it finishes.
  useEffect(() => {
    if (!data || data.readOnly || !staleSnapshot || generating) return;
    void refresh();
  }, [data, staleSnapshot, generating]);

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

  const missingVisible = visible.filter((item) => !item.available).length;
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
      setLightboxItems((current) => current.map((candidate) => candidate.metadataPath === item.metadataPath ? { ...candidate, metadata } : candidate));
      setReviewSaves((current) => ({ ...current, [item.metadataPath]: "saved" }));
    } catch {
      setReviewSaves((current) => ({ ...current, [item.metadataPath]: "error" }));
    }
  }

  async function updateProjectStatus(project: StudioProject, status: ProjectStatus) {
    if (data?.readOnly || status === project.metadata.status) return;
    setProjectSave("saving");
    try {
      const response = await fetch("/api/project-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.metadata.id, status }) });
      if (!response.ok) throw new Error("Could not save project status.");
      const metadata = await response.json() as StudioProject["metadata"];
      setData((current) => current && ({ ...current, projects: current.projects.map((candidate) => candidate.metadata.id === metadata.id ? { ...candidate, metadata } : candidate) }));
      setProjectSave("saved");
    } catch { setProjectSave("error"); }
  }

  async function deleteOutput(item: StudioGeneration) {
    if (data?.readOnly || !window.confirm(`Delete ${item.outputFile} from shot #${item.shotNumber}? This removes the local file and its provenance record when it is the last output.`)) return;
    try {
      const response = await fetch("/api/delete-output", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metadataPath: item.metadataPath, outputFile: item.outputFile }) });
      if (!response.ok) throw new Error("Could not delete output.");
      setSelected(undefined);
      setLightboxItems([]);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function deletePrototype(project: StudioProject, prototype: StudioProject["prototypes"][number]) {
    if (data?.readOnly || !window.confirm(`Delete the ${prototype.title} prototype and all of its local files?`)) return;
    try {
      const response = await fetch("/api/delete-prototype", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.metadata.id, slug: prototype.slug }) });
      if (!response.ok) throw new Error("Could not delete prototype.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function openGeneration(target: StudioGeneration) {
    const sequence = data?.generations.filter((candidate) => candidate.projectId === target.projectId) ?? [target];
    const index = sequence.findIndex((candidate) => candidate.metadataPath === target.metadataPath && candidate.outputFile === target.outputFile);
    setLightboxItems(sequence);
    setSelected(index < 0 ? 0 : index);
  }

  if (error) return <main className="state"><p className="eyebrow">Figment Studio</p><h1>Couldn’t open the lab.</h1><p>{error}</p></main>;
  if (!data) return <main className="state"><p className="eyebrow">Figment Studio</p><h1>Opening the lab…</h1></main>;

  return <div className={`shell ${data.readOnly ? "read-only" : ""} ${sidebarOpen ? "sidebar-open" : ""}`}>
    <button type="button" className="sidebar-scrim" tabIndex={-1} aria-hidden="true" onClick={() => setSidebarOpen(false)} />
    <aside className="sidebar" id="studio-sidebar">
      <div className="brand">
        <span className="brand-mark" tabIndex={0} aria-label="Fig, the Figment mascot">
          <img className="brand-avatar brand-avatar-default" src="./fig-avatar.png" alt="" />
          <img className="brand-avatar brand-avatar-hover" src="./fig-avatar-hover.png" alt="" />
        </span>
        <span>Figment</span>
      </div>
      <nav className="project-list" aria-label="Projects">
        <button className={`project-row ${projectId === "all" ? "active" : ""}`} onClick={() => { setProjectId("all"); setView("gallery"); }}>
          <span>All work</span><small>{data.generations.length}</small>
        </button>
        {groupYears(data.projects).map(([year, projects]) => <section className="year" key={year}>
          <p>{year}</p>
          {projects.map((project) => <button className={`project-row ${projectId === project.metadata.id ? "active" : ""}`} key={project.metadata.id} onClick={() => { setProjectId(project.metadata.id); setView("gallery"); }}>
            <span>{project.metadata.title}</span><i className={`status ${project.metadata.status}`} title={`${friendlyStatus(project.metadata.status)} project`} />
          </button>)}
        </section>)}
      </nav>
      <ThemeControl value={theme} onChange={setTheme} />
      <ActivityLight readOnly={Boolean(data.readOnly)} activity={activity} scannedAt={data.scannedAt} pending={pendingOutputs} stale={staleSnapshot} refreshing={refreshing} onRefresh={() => void refresh()} />
    </aside>

    <main className="workspace">
      <div className="workspace-header">
        <header className="topbar">
          <div>
            <button type="button" className="sidebar-toggle" aria-expanded={sidebarOpen} aria-controls="studio-sidebar" onClick={() => setSidebarOpen((current) => !current)}>
              <span aria-hidden="true">☰</span> Projects
            </button>
            <div className="project-context">
              <p className="eyebrow">{activeProject ? activeProject.year : "Creative archive"}</p>
              {activeProject && <>
                <label className="project-status-control" title="Project status">
                  <i className={`status ${activeProject.metadata.status}`} aria-hidden="true" />
                  <select aria-label={`Status for ${activeProject.metadata.title}`} value={activeProject.metadata.status} disabled={data.readOnly || projectSave === "saving"} onChange={(event) => void updateProjectStatus(activeProject, event.target.value as ProjectStatus)}>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="complete">Complete</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <span className={`project-save ${projectSave}`} role="status" aria-live="polite">{projectSave === "saving" ? "Saving…" : projectSave === "saved" ? "Saved" : projectSave === "error" ? "Couldn’t save" : ""}</span>
              </>}
            </div>
            <h1>{activeProject?.metadata.title ?? "All work"}</h1>
          </div>
          <nav>
            {data.readOnly && <span className="snapshot-badge" title="This published build cannot write back to project files">Published snapshot</span>}
            <button className={view === "gallery" ? "active" : ""} onClick={() => setView("gallery")}>Gallery</button>
            {activeProject && <button className={view === "brief" ? "active" : ""} onClick={() => setView("brief")}>Brief</button>}
            {activeProject && <button className={view === "references" ? "active" : ""} onClick={() => setView("references")}>References</button>}
            {activeProject && <button className={view === "prototypes" ? "active" : ""} onClick={() => setView("prototypes")}>Prototypes</button>}
          </nav>
        </header>

        {view === "gallery" && <div className="filters">
            <Select label="Category" value={category} options={categories} onChange={setCategory} />
            <Select label="Model" value={model} options={models} onChange={setModel} />
            <Select label="Batch" value={batch} options={batches} onChange={setBatch} />
            <Select label="Review" value={review} options={["favourite", "shortlist", "reject", "unreviewed"]} onChange={setReview} />
            {tags.length > 0 && <Select label="Tag" value={tag} options={tags} onChange={setTag} />}
            <button className={`rejected-toggle ${showRejected ? "active" : ""}`} type="button" aria-pressed={showRejected} onClick={() => setShowRejected((current) => !current)}>{showRejected ? "Hide rejected" : "Show rejected"}</button>
            <span className="count">{visible.length} {visible.length === 1 ? "output" : "outputs"}</span>
            {missingVisible > 0 && <span className="count missing" title="These generations are recorded, but their files are not in this working copy">{missingVisible} not available locally</span>}
          </div>}
      </div>

      {view === "gallery" && <>
        {visible.length ? <div className="gallery">{visible.map((item, index) => <GalleryCard item={item} key={`${item.metadataPath}-${item.outputIndex}`} onOpen={() => { setLightboxItems(visible); setSelected(index); }} onReview={(patch) => void patchReview(item, patch)} />)}</div>
          : <Empty hasProjects={data.projects.length > 0} />}
      </>}

      {activeProject && view === "brief" && <DocumentView project={activeProject} />}
      {activeProject && view === "references" && <References project={activeProject} />}
      {activeProject && view === "prototypes" && <Prototypes project={activeProject} onDelete={(prototype) => void deletePrototype(activeProject, prototype)} />}
    </main>
    {selected !== undefined && lightboxItems[selected] && <Lightbox item={lightboxItems[selected]} project={data.projects.find((project) => project.metadata.id === lightboxItems[selected]!.projectId)} generations={data.generations} position={selected} total={lightboxItems.length} saveState={reviewSaves[lightboxItems[selected]!.metadataPath] ?? "idle"} onClose={() => { setSelected(undefined); setLightboxItems([]); }} onMove={(step) => setSelected((selected + step + lightboxItems.length) % lightboxItems.length)} onReview={(patch) => void patchReview(lightboxItems[selected]!, patch)} onDelete={() => void deleteOutput(lightboxItems[selected]!)} onOpenGeneration={openGeneration} />}
  </div>;
}

function ActivityLight({ readOnly, activity, scannedAt, pending, stale, refreshing, onRefresh }: { readOnly: boolean; activity?: StudioActivity; scannedAt: string; pending: number; stale: boolean; refreshing: boolean; onRefresh: () => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (readOnly) return <div className="sidebar-note snapshot"><span>Static snapshot</span><small>Built {timeAgo(scannedAt)}</small></div>;
  const generating = activity?.generating ?? false;
  const batch = activity?.batches[0];
  const others = (activity?.batches.length ?? 0) - 1;
  const label = generating ? "Generating" : stale ? pending > 0 ? `${pending} new ${pending === 1 ? "output" : "outputs"}` : "Project files changed" : "Filesystem live";
  const detail = generating && batch
    ? `${batch.projectTitle} · ${batch.kind} ${batch.completed}/${batch.total}${others > 0 ? ` · +${others} more` : ""}`
    : `Scanned ${timeAgo(scannedAt)}`;
  return <div className={`sidebar-note ${generating ? "generating" : stale ? "waiting" : "live"}`}>
    <span role="status" aria-live="polite">{label}</span>
    <small>{detail}</small>
    {(generating || stale) && <button type="button" className="sidebar-refresh" disabled={refreshing} onClick={onRefresh} title={generating ? "Pull in finished work without waiting for the run to end" : "Load the latest project files"}>
      {refreshing ? "Refreshing…" : pending > 0 ? `Show ${pending} now` : "Refresh now"}
    </button>}
  </div>;
}

function GalleryCard({ item, onOpen, onReview }: { item: StudioGeneration; onOpen: () => void; onReview: (patch: ReviewPatch) => void }) {
  return <article className={`card ${item.metadata.review.signal === "reject" ? "rejected" : ""}`}>
    <button className="artwork" onClick={onOpen}><Media item={item} hoverPlay thumbnail /><span className="kind">{friendlyCategory(item.category)}</span><span className="shot-number">#{item.shotNumber}</span></button>
    <button className={`heart card-heart ${item.metadata.review.favourite ? "active" : ""}`} aria-label={`Favourite shot ${item.shotNumber}`} onClick={() => onReview(item.metadata.review.favourite ? clearDirection() : { favourite: true, signal: "unreviewed" })}>♥</button>
  </article>;
}

function Media({ item, hoverPlay = false, autoPlay = false, thumbnail = false }: { item: StudioGeneration; hoverPlay?: boolean; autoPlay?: boolean; thumbnail?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  // The scan reports what was on disk; a file can still vanish between the scan and the render.
  // Each refresh hands down a fresh item, which clears the failure so a restored file is retried.
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [item]);
  if (!item.available || failed) return <MissingMedia item={item} />;
  // A mesh is tens of megabytes and needs WebGL. Grid cells show a marker instead, so
  // scrolling a project full of meshes never downloads or renders any of them.
  // A mesh is tens of megabytes and needs WebGL, so the grid shows the job's own
  // rendered preview when there is one and only the opened shot becomes interactive.
  if (item.mediaType === "model") {
    if (thumbnail) return item.thumbnailUrl
      ? <img src={item.thumbnailUrl} alt={item.metadata.prompt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      : <ModelMarker />;
    return <ModelViewer item={item} onError={() => setFailed(true)} />;
  }
  // A grid cell is ~225px wide; handing it the source art costs tens of megabytes of bitmap per card.
  if (item.mediaType !== "video") return <img src={(thumbnail && item.thumbnailUrl) || item.imageUrl} alt={item.metadata.prompt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  const play = () => { if (hoverPlay) void video.current?.play(); };
  const pause = () => { if (hoverPlay && video.current) { video.current.pause(); video.current.currentTime = 0; } };
  const showFirstFrame = () => {
    if (!thumbnail || !video.current || !Number.isFinite(video.current.duration)) return;
    video.current.currentTime = Math.min(0.1, Math.max(0, video.current.duration / 2));
    video.current.pause();
  };
  return <video ref={video} className="media-video" src={item.imageUrl} muted playsInline loop preload={autoPlay ? "auto" : thumbnail ? "metadata" : "none"} autoPlay={autoPlay} aria-label={item.metadata.prompt} onLoadedMetadata={showFirstFrame} onLoadedData={showFirstFrame} onMouseEnter={play} onMouseLeave={pause} onFocus={play} onBlur={pause} onError={() => setFailed(true)} />;
}

function ModelMarker() {
  return <span className="media-model-marker" role="img" aria-label="3D model">
    <span className="media-model-mark" aria-hidden="true">◈</span>
    <small>3D model</small>
  </span>;
}

// model-viewer is a heavy web component and most projects hold no meshes at all, so it
// is imported the first time one is actually opened rather than bundled into the gallery.
let modelViewerLoad: Promise<unknown> | undefined;
function loadModelViewer(): Promise<unknown> {
  modelViewerLoad ??= import("@google/model-viewer");
  return modelViewerLoad;
}

function ModelViewer({ item, onError }: { item: StudioGeneration; onError: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    loadModelViewer().then(() => { if (live) setReady(true); }).catch(() => { if (live) onError(); });
    return () => { live = false; };
  }, [item.imageUrl]);

  // The poster keeps the shot visible while tens of megabytes of mesh download, so the
  // lightbox never sits blank; a neutral studio environment lights the matte toy
  // surfaces evenly rather than with model-viewer's default warm cast.
  if (!ready) return item.posterUrl
    ? <img className="media-model-poster" src={item.posterUrl} alt={item.metadata.prompt} />
    : <span className="media-model-marker" role="status"><span className="media-model-mark" aria-hidden="true">◈</span><small>Loading 3D…</small></span>;
  return <model-viewer
    className="media-model"
    src={item.imageUrl}
    poster={item.posterUrl}
    alt={item.metadata.prompt}
    camera-controls
    auto-rotate
    rotation-per-second="18deg"
    interaction-prompt="none"
    environment-image="neutral"
    tone-mapping="neutral"
    shadow-intensity="0.9"
    shadow-softness="0.8"
    exposure="1.15"
    min-field-of-view="20deg"
  />;
}

// The provenance is still here, so name the file that is missing rather than showing a broken image.
function MissingMedia({ item }: { item: StudioGeneration }) {
  return <span className="media-missing" role="img" aria-label={`${item.outputFile} is not available locally`}>
    <span className="media-missing-mark" aria-hidden="true">◫</span>
    <strong>Not available locally</strong>
    <small>{item.outputFile}</small>
  </span>;
}

// Both lightboxes share this shell so the art stays centred and the panel behaves the same in each.
function LightboxShell({ ariaLabel, onClose, onMove, canMove = true, art, details }: { ariaLabel?: string; onClose: () => void; onMove: (step: number) => void; canMove?: boolean; art: React.ReactNode; details: React.ReactNode }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "escape") onClose();
      else if (key === "arrowleft" && canMove) onMove(-1);
      else if (key === "arrowright" && canMove) onMove(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [canMove, onClose, onMove]);
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label={ariaLabel} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="close" onClick={onClose}>Close <span>×</span></button>
    <button className="previous" aria-label="Previous" title="Previous · Left arrow" disabled={!canMove} onClick={() => onMove(-1)}>←</button>
    <div className="lightbox-art">{art}</div>
    <button className="next" aria-label="Next" title="Next · Right arrow" disabled={!canMove} onClick={() => onMove(1)}>→</button>
    <aside className="details">{details}</aside>
  </div>;
}

function Lightbox({ item, project, generations, position, total, saveState, onClose, onMove, onReview, onDelete, onOpenGeneration }: { item: StudioGeneration; project?: StudioProject; generations: StudioGeneration[]; position: number; total: number; saveState: ReviewSaveState; onClose: () => void; onMove: (step: number) => void; onReview: (patch: ReviewPatch) => void; onDelete: () => void; onOpenGeneration: (item: StudioGeneration) => void }) {
  const [note, setNote] = useState(item.metadata.review.note ?? "");
  const [tags, setTags] = useState(item.metadata.review.tags.join(", "));
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "1") onReview(item.metadata.review.favourite ? clearDirection() : { favourite: true, signal: "unreviewed" });
      else if (key === "2") onReview(item.metadata.review.signal === "shortlist" ? clearDirection() : { favourite: false, signal: "shortlist" });
      else if (key === "3") onReview(item.metadata.review.signal === "reject" ? clearDirection() : { favourite: false, signal: "reject" });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [item.metadata.review, onReview]);
  useEffect(() => { setNote(item.metadata.review.note ?? ""); setTags(item.metadata.review.tags.join(", ")); }, [item]);
  const cost = item.metadata.actualCost ?? item.metadata.estimatedCost;
  return <LightboxShell ariaLabel={`Shot ${item.shotNumber}`} onClose={onClose} onMove={onMove} canMove={total > 1}
    art={<Media key={`${item.metadataPath}-${item.outputFile}`} item={item} autoPlay />}
    details={<>
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
      <button className="delete-action" type="button" onClick={onDelete}>Delete output…</button>
      <p className={`review-save ${saveState}`} role="status" aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved to project files" : saveState === "error" ? "Couldn’t save — try again" : ""}</p>
      <Detail label="Prompt"><p className="prompt">{item.metadata.prompt}</p></Detail>
      <div className="facts"><Fact label="Model" value={item.metadata.model} /><Fact label="Cost" value={cost ? `${cost.kind === "estimate" ? "~" : ""}$${cost.amount.toFixed(3)}` : "Unknown"} /><Fact label="Created" value={new Date(item.metadata.createdAt).toLocaleString()} /><Fact label="Dimensions" value={dimensions(item.metadata)} /></div>
      <Detail label="Review note"><textarea value={note} placeholder="What works? What needs to change?" onChange={(event) => setNote(event.target.value)} onBlur={() => onReview({ note })} /></Detail>
      <Detail label="Tags"><input value={tags} placeholder="expressive, face, warm" onChange={(event) => setTags(event.target.value)} onBlur={() => onReview({ tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) })} /></Detail>
      {item.metadata.references.length > 0 && <GenerationReferences item={item} project={project} generations={generations} onOpenGeneration={onOpenGeneration} />}
      {item.metadata.parentGenerationId && <Detail label="Lineage"><p>Derived from {item.metadata.parentGenerationId}</p></Detail>}
      <details><summary>Parameters & provenance</summary><pre>{JSON.stringify({ batch: item.batchName, jobId: item.metadata.jobId, parameters: item.metadata.parameters, references: item.metadata.references, provider: item.metadata.provider }, null, 2)}</pre></details>
    </>}
  />;
}

function GenerationReferences({ item, project, generations, onOpenGeneration }: { item: StudioGeneration; project?: StudioProject; generations: StudioGeneration[]; onOpenGeneration: (item: StudioGeneration) => void }) {
  return <Detail label="References"><div className="generation-references">{item.metadata.references.map((reference) => {
    const source = reference.source;
    const target = source && generations.find((candidate) => candidate.projectId === source.projectId
      && normalPath(candidate.metadataPath).endsWith(`/${normalPath(source.metadataPath)}`)
      && candidate.outputFile === source.outputFile);
    const libraryReference = project?.references.find((candidate) => normalPath(candidate.path).endsWith(`/${normalPath(reference.localPath)}`));
    const imageUrl = target?.thumbnailUrl ?? target?.imageUrl ?? libraryReference?.thumbnailUrl ?? libraryReference?.url;
    const label = source ? `Shot #${source.shotNumber}` : fileName(reference.localPath);
    const caption = source ? "Source generation" : "Reference file";
    const content = <>{imageUrl ? <img src={imageUrl} alt={label} loading="lazy" decoding="async" /> : <span className="reference-placeholder" aria-hidden="true">◫</span>}<span><strong>{label}</strong><small>{caption}</small></span></>;
    return target
      ? <button type="button" className="generation-reference" key={`${reference.localPath}-${source?.shotNumber ?? "file"}`} onClick={() => onOpenGeneration(target)} title={`Open ${label}`}>{content}</button>
      : <div className="generation-reference" key={`${reference.localPath}-${source?.shotNumber ?? "file"}`}>{content}</div>;
  })}</div></Detail>;
}

function DocumentView({ project }: { project: StudioProject }) {
  const [tab, setTab] = useState<"brief" | "decisions">("brief");
  return <div className="document-wrap"><div className="document-tabs"><button className={tab === "brief" ? "active" : ""} onClick={() => setTab("brief")}>Creative brief</button><button className={tab === "decisions" ? "active" : ""} onClick={() => setTab("decisions")}>Decision history</button></div><Markdown source={project[tab]} /></div>;
}

function References({ project }: { project: StudioProject }) {
  const [selected, setSelected] = useState<number>();
  // Reopening the library after switching project should not restore an index that no longer exists.
  useEffect(() => { setSelected(undefined); }, [project.metadata.id]);
  if (!project.references.length) return <div className="empty"><p className="eyebrow">Reference library</p><h2>No references yet.</h2><p>Place original images in <code>projects/{project.year}/{project.metadata.slug}/references/</code>. Figment will never modify them.</p></div>;
  return <>
    <div className="reference-grid">{project.references.map((reference, index) => <figure key={reference.path}>
      <button type="button" className="reference-open" onClick={() => setSelected(index)} title={`Inspect ${reference.name}`}>
        <img src={reference.thumbnailUrl ?? reference.url} alt={reference.name} loading="lazy" decoding="async" />
      </button>
      <figcaption>{reference.name}</figcaption>
    </figure>)}</div>
    {selected !== undefined && project.references[selected] && <ReferenceLightbox
      references={project.references}
      position={selected}
      onClose={() => setSelected(undefined)}
      onMove={(step) => setSelected((selected + step + project.references.length) % project.references.length)}
    />}
  </>;
}

// References are source material, not generated work, so this reuses the shell without review controls.
function ReferenceLightbox({ references, position, onClose, onMove }: { references: StudioProject["references"]; position: number; onClose: () => void; onMove: (step: number) => void }) {
  const reference = references[position]!;
  return <LightboxShell ariaLabel={reference.name} onClose={onClose} onMove={onMove} canMove={references.length > 1}
    art={<img key={reference.path} src={reference.url} alt={reference.name} />}
    details={<>
      <p className="eyebrow">Reference · {position + 1} / {references.length}</p>
      <h2>{reference.name}</h2>
      <div className="review-guide"><p>Original source material. Figment never modifies the reference library.</p></div>
      <Detail label="Location"><p className="prompt">{reference.path}</p></Detail>
    </>}
  />;
}

function Prototypes({ project, onDelete }: { project: StudioProject; onDelete: (prototype: StudioProject["prototypes"][number]) => void }) {
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
      <header><div><p className="eyebrow">{selected.kind} prototype</p><h2>{selected.title}</h2>{selected.description && <p>{selected.description}</p>}</div><div className="prototype-actions">{selected.launchUrl && <a href={selected.launchUrl} target="_blank" rel="noreferrer">Open in new tab ↗</a>}<button type="button" className="delete-action" onClick={() => onDelete(selected)}>Delete prototype…</button></div></header>
      {selected.launchUrl && selected.embeddable
        ? <iframe src={selected.launchUrl} title={`${selected.title} prototype`} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads" />
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
function friendlyStatus(status: ProjectStatus) { return status.slice(0, 1).toUpperCase() + status.slice(1); }
function dimensions(item: StudioGeneration["metadata"]) { return item.width && item.height ? `${item.width} × ${item.height}` : item.aspectRatio ?? item.resolution ?? "Unknown"; }
function clearDirection(): ReviewPatch { return { favourite: false, signal: "unreviewed" }; }
function timeAgo(value: string) { const seconds = Math.round((Date.now() - Date.parse(value)) / 1000); return seconds < 60 ? "just now" : `${Math.round(seconds / 60)}m ago`; }
function normalPath(value: string) { return value.replaceAll("\\", "/"); }
function fileName(value: string) { return normalPath(value).split("/").at(-1) ?? value; }
function readStudioPreferences(): Partial<StudioPreferences> {
  try {
    const value = JSON.parse(localStorage.getItem(STUDIO_PREFERENCES_KEY) ?? "{}") as Record<string, unknown>;
    const view = ["gallery", "brief", "references", "prototypes"].includes(String(value.view)) ? value.view as View : undefined;
    const text = (key: string) => typeof value[key] === "string" ? value[key] as string : undefined;
    return { projectId: text("projectId"), view, model: text("model"), category: text("category"), batch: text("batch"), review: text("review"), tag: text("tag"), showRejected: typeof value.showRejected === "boolean" ? value.showRejected : undefined };
  } catch { return {}; }
}
