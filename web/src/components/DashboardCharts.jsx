import { Icon } from "../admin";

const formatCount = (value) => value.toLocaleString("en-PH");
const percentage = (value, total) => total > 0 ? Math.round(value / total * 100) : 0;

function ChartHeading({ id, title, description, icon }) {
  return <div className="admin-chart-heading"><span className="admin-chart-icon"><Icon name={icon} size={20} /></span><div><h3 id={id}>{title}</h3><p>{description}</p></div></div>;
}

function ChartMessage({ children }) {
  return <p className="admin-chart-message" role="status">{children}</p>;
}

export function ParticipationCharts({ stats, busy }) {
  const active = stats?.activeStudents ?? 0;
  const voted = stats?.voted ?? 0;
  const remaining = Math.max(0, active - voted);
  const turnout = percentage(voted, active);
  const tokens = stats?.tokens ?? 0;
  const used = stats?.usedTokens ?? 0;
  const unused = Math.max(0, tokens - used);
  const tokenPercentage = percentage(used, tokens);

  return <section className="admin-charts-grid" aria-label="Current election charts">
    <article className="admin-chart-card" aria-labelledby="admin-turnout-chart-title">
      <ChartHeading id="admin-turnout-chart-title" title="Voter turnout" description="Participation in the current election" icon="turnout" />
      {!stats ? <ChartMessage>{busy ? "Loading participation data…" : "Participation data is unavailable."}</ChartMessage> : <>
        <div className="admin-turnout-chart">
          <div className="admin-donut-wrap">
            <svg className="admin-donut" viewBox="0 0 160 160" role="img" aria-label={`${turnout}% turnout: ${voted} of ${active} active students have voted.`}>
              <circle className="admin-donut-track" cx="80" cy="80" r="64" />
              <circle className="admin-donut-value" cx="80" cy="80" r="64" pathLength="100" strokeDasharray={`${Math.min(100, turnout)} 100`} transform="rotate(-90 80 80)" />
            </svg>
            <div className="admin-donut-label" aria-hidden="true"><strong>{turnout}<small>%</small></strong><span>turnout</span></div>
          </div>
          <dl className="admin-chart-legend">
            <div><dt><i className="admin-chart-dot blue" />Voted</dt><dd>{formatCount(voted)}</dd></div>
            <div><dt><i className="admin-chart-dot pale" />Not yet voted</dt><dd>{formatCount(remaining)}</dd></div>
            <div className="admin-chart-legend-total"><dt>Active students</dt><dd>{formatCount(active)}</dd></div>
          </dl>
        </div>
        <p className="admin-chart-note">{active ? "Includes completed submissions with all positions abstained." : "No active students registered yet."}</p>
      </>}
    </article>
    <article className="admin-chart-card" aria-labelledby="admin-token-chart-title">
      <ChartHeading id="admin-token-chart-title" title="Voting token usage" description="Used and unused issued tokens" icon="key" />
      {!stats ? <ChartMessage>{busy ? "Loading token data…" : "Token data is unavailable."}</ChartMessage> : <>
        <div className="admin-token-highlight"><strong>{tokenPercentage}<small>%</small></strong><span>of issued tokens used</span></div>
        <div className="admin-token-chart" role="img" aria-label={`${used} used tokens and ${unused} unused tokens out of ${tokens} issued tokens.`}>
          <div className="admin-token-used" style={{ width: `${Math.min(100, tokenPercentage)}%` }} />
        </div>
        <dl className="admin-chart-legend admin-token-legend">
          <div><dt><i className="admin-chart-dot teal" />Used</dt><dd>{formatCount(used)}</dd></div>
          <div><dt><i className="admin-chart-dot pale" />Unused</dt><dd>{formatCount(unused)}</dd></div>
          <div className="admin-chart-legend-total"><dt>Issued tokens</dt><dd>{formatCount(tokens)}</dd></div>
        </dl>
        <p className="admin-chart-note">{tokens ? "Token counts reflect the current election." : "Generate voting tokens to start tracking usage."}</p>
      </>}
    </article>
  </section>;
}

export function PositionVotesChart({ positions }) {
  if (!positions.length) return null;
  const rows = positions.map((position) => ({
    ...position,
    total: position.candidates.reduce((sum, candidate) => sum + candidate.votes, 0),
  }));
  const maximum = Math.max(1, ...rows.map((position) => position.total));
  // Keep whole-number tick marks, including elections with only a few votes.
  const step = Math.max(1, Math.ceil(maximum / 4));
  const scale = step * 4;
  const hasVotes = rows.some((position) => position.total > 0);

  return <section className="admin-position-chart" aria-labelledby="admin-position-chart-title">
    <ChartHeading id="admin-position-chart-title" title="Votes by position" description="Candidate votes for the selected election and positions" icon="ledger" />
    <div className="admin-bar-axis" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index}>{formatCount(index * step)}</span>)}</div>
    <ul className="admin-bar-list" aria-label="Total candidate votes per position">{rows.map((position) => <li className="admin-bar-row" key={position.index}>
      <span className="admin-bar-label" title={position.name}>{position.name}</span>
      <div className="admin-bar-track" aria-hidden="true"><div className="admin-bar-fill" style={{ width: `${position.total / scale * 100}%` }} /></div>
      <strong className="admin-bar-count">{formatCount(position.total)}<span> votes</span></strong>
    </li>)}</ul>
    <p className="admin-chart-note">{hasVotes ? "Each position is counted separately. Abstentions are excluded." : "No candidate votes recorded for the selected positions yet."}</p>
  </section>;
}
