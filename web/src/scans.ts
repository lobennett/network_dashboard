import {element, type RecordRow} from './review';

type ScanData = {entities:RecordRow[]; findings:RecordRow[]; decisions:RecordRow[]};

export function scanPrefix(scan: RecordRow): string {
  return [['sub',scan.subject],['ses',scan.session],['task',scan.task],['acq',scan.acquisition],['run',scan.run]]
    .filter(([,value]) => value).map(([key,value]) => `${key}-${value}`).join('_');
}

export function renderScans(data: ScanData, select: (scan: RecordRow) => void): HTMLElement {
  const panel = element('div');
  const scans = data.entities.filter(e => e.namespace === 'raw' && ['bold','T1w','T2w'].includes(String(e.suffix)) && !e.echo)
    .sort((a,b) => scanPrefix(a).localeCompare(scanPrefix(b), undefined, {numeric:true}));
  const label = element('label','Filter scans');
  const filter = element('input');
  filter.placeholder = 'Session, task, or review flag';
  label.append(filter);
  const count = element('p',`${scans.length} scans`, 'muted');
  const scroll = element('div','','scan-table');
  const table = element('table');
  const head = element('thead');
  const heading = element('tr');
  for (const text of ['Session','Scan','Run','TRs','Mean FD (mm)','Preprocessing','Task models','Flags']) heading.append(element('th',text));
  head.append(heading);
  const body = element('tbody');
  table.append(head,body); scroll.append(table); panel.append(label,count,scroll);
  const entries = scans.map(scan => {
    const evidence = data.findings.find(f => f.entity_key === scan.entity_key && f.finding_type === 'scan-review');
    const metrics = evidence ? JSON.parse(String(evidence.evidence_json)) : {};
    const decisions = data.decisions.filter(d => d.entity_key === scan.entity_key);
    const preprocessing = decisions.find(d => d.scope === 'preprocessing')?.decision ?? 'unrecorded';
    const excluded = decisions.some(d => d.scope === 'task_first_level' && d.decision === 'exclude');
    const row = element('tr');
    row.append(element('td',String(scan.session ?? '—')));
    const name = element('td');
    const button = element('button',String(scan.task ?? scan.suffix));
    button.onclick = () => select(scan);
    name.append(button); row.append(name);
    const fd = metrics.fd_mean && Number.isFinite(Number(metrics.fd_mean)) ? Number(metrics.fd_mean).toFixed(3) : '—';
    for (const text of [scan.run ?? '—',metrics.tr_count ?? '—',fd,preprocessing,
        excluded ? 'exclude' : 'No exclusion recorded',metrics.flags || '—']) row.append(element('td',String(text)));
    body.append(row);
    return {row, text: `${scanPrefix(scan)} ${metrics.flags ?? ''}`.toLowerCase()};
  });
  filter.oninput = () => {
    for (const entry of entries) entry.row.hidden = !entry.text.includes(filter.value.toLowerCase());
    count.textContent = `${entries.filter(e => !e.row.hidden).length} of ${scans.length} scans`;
  };
  return panel;
}
