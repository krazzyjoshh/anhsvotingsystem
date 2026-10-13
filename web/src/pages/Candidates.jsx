import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Msg } from "../ui";
import { Icon } from "../admin";
import { PageHeading, SummaryCards, PanelHeading, EmptyState, NameAvatar } from "../components/PageUI";
import Modal from "../components/StudentModal";

function CandidateForm({ initial, positions, students, onSave, onCancel, busy = false, message }) {
  const [v, setV] = useState(initial);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  function pick(e) {
    const s = students.find((x) => String(x.id) === e.target.value);
    if (!s) return;
    setV({
      ...v,
      full_name: [s.first_name, s.given_name, s.last_name].filter(Boolean).join(" "),
      grade: s.grade,
      section: s.section,
    });
  }

  return <form className="card" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
    <PanelHeading title="Add candidate" description="Select a student or enter the candidate’s information." icon="candidate" />
    <Msg m={message} />
    <fieldset className="page-form-grid" disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
      <label className="page-field-wide">Student (optional)<select aria-label="Candidate student" onChange={pick} defaultValue=""><option value="">— Select a student (optional) —</option>{students.map((s) => <option key={s.id} value={s.id}>{s.last_name}, {s.first_name} ({s.grade} {s.section})</option>)}</select></label>
      <label>Position<select aria-label="Candidate position" value={v.position_id} onChange={set("position_id")} required>{positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Full name<input placeholder="Full name (max 40 characters)" maxLength={40} value={v.full_name} onChange={set("full_name")} required /></label>
      <label>Partylist<input placeholder="Partylist" value={v.partylist} onChange={set("partylist")} /></label>
      <label>Grade<input placeholder="Grade" value={v.grade} onChange={set("grade")} /></label>
      <label>Section<input placeholder="Section" value={v.section} onChange={set("section")} /></label>
      <label>Photo URL<input placeholder="Photo URL (optional, http/https)" value={v.photo_url} onChange={set("photo_url")} /></label>
    </fieldset><div className="page-form-actions"><button type="submit" disabled={busy}><Icon name="check" size={16} />{busy ? "Saving..." : "Save"}</button><button type="button" className="ghost" disabled={busy} onClick={onCancel}>Close</button></div>
  </form>;
}

const blank = (positions) => ({
  full_name: "", position_id: positions[0]?.id ?? "", partylist: "", grade: "", section: "", photo_url: "",
});

export default function Candidates() {
  const [data, setData] = useState({ positions: [], published: false });
  const [students, setStudents] = useState([]);
  const [posName, setPosName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addingPosition, setAddingPosition] = useState(false);
  const [positionBusy, setPositionBusy] = useState(false);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [m, setM] = useState(null);

  const load = useCallback(async () => setData(await api("/admin/election")), []);

  useEffect(() => {
    load().catch((e) => setM({ type: "err", text: e.message }));
    api("/admin/students").then((d) => setStudents(d.students)).catch(() => {});
  }, [load]);

  async function run(fn, ok) {
    try {
      await fn();
      setM({ type: "ok", text: ok });
      await load();
      return true;
    } catch (e) {
      setM({ type: "err", text: e.message });
      return false;
    }
  }

  async function save(v) {
    if (candidateBusy) return;
    setCandidateBusy(true);
    const body = { ...v, position_id: Number(v.position_id) };
    try {
      if (await run(() => api("/admin/candidates", { method: "POST", body }), "Candidate added.")) setAdding(false);
    } finally { setCandidateBusy(false); }
  }

  async function addPosition(event) {
    event.preventDefault();
    if (positionBusy) return;
    setPositionBusy(true);
    try {
      if (await run(() => api("/admin/positions", { method: "POST", body: { name: posName } }), "Position added.")) {
        setPosName("");
        setAddingPosition(false);
      }
    } finally { setPositionBusy(false); }
  }

  const locked = data.published;
  const P = data.positions;

  return <div className="admin-content candidates-page">
    <PageHeading title="Candidates and Positions" subtitle="Set up positions and candidates for the ANHS ballot." icon="candidate">
      {!locked && <button type="button" className="ghost" disabled={positionBusy || candidateBusy} aria-haspopup="dialog" aria-expanded={addingPosition} aria-controls="position-add-modal" onClick={() => { setM(null); setAddingPosition(true); }}><Icon name="ledger" size={16} />Add position</button>}
      {!locked && P.length > 0 && <button type="button" disabled={positionBusy || candidateBusy} aria-haspopup="dialog" aria-expanded={adding} aria-controls="candidate-add-modal" onClick={() => { setM(null); setAdding(true); }}><Icon name="candidate" size={16} />Add candidate</button>}
    </PageHeading>
    {!addingPosition && !adding && <Msg m={m} />}
    <SummaryCards items={[
      {label:"Positions", value:P.length, detail:"Positions on the ballot", icon:"ledger"},
      {label:"Candidates", value:P.reduce((n,p) => n+p.candidates.length,0), detail:"Current list", icon:"candidate"},
      {label:"Ballot setup", value:locked ? "Locked" : "Editable", detail:locked ? "Published on the blockchain" : "More entries can be added", icon:"lock"},
    ]} />
    {locked && <div className="page-info-banner"><Icon name="lock" size={20} /><span>This is locked because the election has been published to the blockchain.</span></div>}
    {!locked && <Modal id="position-add-modal" label="Add position" open={addingPosition} busy={positionBusy} onClose={() => setAddingPosition(false)}>
      <form className="card" onSubmit={addPosition}>
        <PanelHeading title="Add position" description="Add a position before adding candidates." icon="ledger" />
        {addingPosition && <Msg m={m} />}
        <div className="page-form-grid"><label className="page-field-wide">Position name<input placeholder="New position (max 32 characters)" required maxLength={32} disabled={positionBusy} value={posName} onChange={(e) => setPosName(e.target.value)} /></label></div>
        <div className="page-form-actions"><button type="submit" disabled={positionBusy}><Icon name="ledger" size={16} />{positionBusy ? "Saving..." : "Add position"}</button><button type="button" className="ghost" disabled={positionBusy} onClick={() => setAddingPosition(false)}>Close</button></div>
      </form>
    </Modal>}
    {adding && !locked && <Modal id="candidate-add-modal" label="Add candidate" open={adding} busy={candidateBusy} onClose={() => setAdding(false)}>
      <CandidateForm initial={blank(P)} positions={P} students={students} onSave={save} onCancel={() => setAdding(false)} busy={candidateBusy} message={m} />
    </Modal>}
    <div className="page-position-grid">{P.map((p) => <section className="card" key={p.id}><PanelHeading title={p.name} icon="ballot"><span className="admin-pill">{p.candidates.length} candidate(s)</span></PanelHeading>
      <div className="page-candidate-list">{p.candidates.map((c) => <article className="page-candidate-profile" key={c.id}><NameAvatar name={c.full_name} /><div><strong>{c.full_name}</strong><small>{[c.partylist,c.grade,c.section].filter(Boolean).join(" · ") || "Candidate"}</small></div><Icon name="candidate" size={17} /></article>)}</div>
      {!p.candidates.length && <EmptyState title="No candidates yet" description="Add a candidate for this position." icon="candidate" />}
    </section>)}</div>
    {!P.length && <section className="card"><EmptyState title="No positions yet" description="Use the Add position button to set up the ballot." icon="ballot" /></section>}
  </div>;
}
