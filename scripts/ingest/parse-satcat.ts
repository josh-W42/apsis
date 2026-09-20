import type { SatcatMeta } from '../../src/catalog/types.ts';

export interface SatcatRow {
  meta: SatcatMeta;
  decayDate: string | null;
}

/** Split one CSV line, honouring double-quoted fields that contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(field); field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

const str = (v: string | undefined): string | null => {
  const t = v?.trim() ?? '';
  return t.length === 0 ? null : t;
};
const num = (v: string | undefined): number | null => {
  const t = v?.trim() ?? '';
  if (t.length === 0) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Parse satcat.csv into a lookup keyed by NORAD catalog id. */
export function parseSatcat(csv: string): Map<number, SatcatRow> {
  const lines = csv.split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '');
  const col = (name: string) => header.indexOf(name);

  const iId = col('NORAD_CAT_ID');
  const iType = col('OBJECT_TYPE');
  const iOwner = col('OWNER');
  const iLaunch = col('LAUNCH_DATE');
  const iDecay = col('DECAY_DATE');
  const iApogee = col('APOGEE');
  const iPerigee = col('PERIGEE');

  const rows = new Map<number, SatcatRow>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    const f = splitCsvLine(line);
    const id = num(f[iId]);
    if (id === null) continue;
    rows.set(id, {
      meta: {
        objectType: str(f[iType]),
        owner: str(f[iOwner]),
        ownerName: null,   // the join supplies this; the parser cannot know it
        launchDate: str(f[iLaunch]),
        apogeeKm: num(f[iApogee]),
        perigeeKm: num(f[iPerigee]),
      },
      decayDate: str(f[iDecay]),
    });
  }
  return rows;
}
