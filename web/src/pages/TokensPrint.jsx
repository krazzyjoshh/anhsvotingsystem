import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import TokensPdfButton from "../components/TokensPdfButton";

export default function TokensPrint() {
  const [sp] = useSearchParams();
  const [tokens, setTokens] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErr("");
    setTokens([]);
    const q = new URLSearchParams(sp);
    q.set("status", "unused");
    api(`/admin/tokens?${q}`)
      .then((d) => { if (active) setTokens(d.tokens.filter((t) => !t.used)); })
      .catch((e) => { if (active) setErr(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sp]);

  return (
    <div style={{ padding: 20 }}>
      <div className="no-print row">
        <button disabled={loading || !tokens.length} onClick={() => window.print()}>Print</button>
        <TokensPdfButton disabled={loading || !tokens.length} getTokens={() => tokens} onError={setErr} />
        <span role="status">{loading ? "Loading tokens..." : `${tokens.length} token(s)`}</span>
        {err && <span className="msg err" role="alert">{err}</span>}
        {!loading && !err && !tokens.length && <span>No unused tokens to print. Adjust the filters or generate tokens first.</span>}
      </div>
      <div className="print-grid">
        {tokens.map((t) => (
          <div className="ticket" key={t.id}>
            <b>{t.last_name ? `${t.last_name}, ${[t.first_name, t.given_name].filter(Boolean).join(" ")}` : "—"}</b>
            <br /><small>{t.grade} {t.section ?? ""}</small>
            <div className="code mono">{t.code}</div>
            <small>ANHS Voting System. Single use only. Do not share with others.</small>
          </div>
        ))}
      </div>
    </div>
  );
}
