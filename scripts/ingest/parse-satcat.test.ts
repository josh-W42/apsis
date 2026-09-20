import { describe, expect, it } from 'vitest';
import { parseSatcat } from './parse-satcat.ts';

const HEADER =
  'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,' +
  'LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,' +
  'RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE';

describe('parseSatcat', () => {
  it('parses a live row', () => {
    const csv = `${HEADER}\nISS (ZARYA),1998-067A,25544,PAY,+,ISS,1998-11-20,TTMTR,,92.8,51.64,420,410,399.05,,EA,ORB`;
    const rows = parseSatcat(csv);
    const iss = rows.get(25544)!;
    expect(iss.meta.objectType).toBe('PAY');
    expect(iss.meta.owner).toBe('ISS');
    expect(iss.meta.apogeeKm).toBe(420);
    expect(iss.meta.perigeeKm).toBe(410);
    expect(iss.decayDate).toBeNull();
  });

  it('records a decay date when present', () => {
    const csv = `${HEADER}\nSL-1 R/B,1957-001A,1,R/B,D,CIS,1957-10-04,TYMSC,1957-12-01,96.19,65.10,938,214,20.42,,EA,IMP`;
    expect(parseSatcat(csv).get(1)!.decayDate).toBe('1957-12-01');
  });

  it('leaves blank numeric fields null rather than NaN', () => {
    const csv = `${HEADER}\nUNKNOWN,2020-999Z,99999,UNK,,TBD,2020-01-01,TBD,,,,,,,,EA,`;
    const row = parseSatcat(csv).get(99999)!;
    expect(row.meta.apogeeKm).toBeNull();
    expect(row.meta.perigeeKm).toBeNull();
  });

  it('handles quoted fields containing commas', () => {
    const csv = `${HEADER}\n"FOO, BAR",2020-001A,12345,PAY,+,US,2020-01-01,AFETR,,90,50,500,490,1.0,,EA,ORB`;
    expect(parseSatcat(csv).get(12345)!.meta.objectType).toBe('PAY');
  });

  it('ignores blank trailing lines', () => {
    const csv = `${HEADER}\nISS (ZARYA),1998-067A,25544,PAY,+,ISS,1998-11-20,TTMTR,,92.8,51.64,420,410,399.05,,EA,ORB\n\n`;
    expect(parseSatcat(csv).size).toBe(1);
  });
});
