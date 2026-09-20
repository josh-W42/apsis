import { describe, expect, it } from 'vitest';

describe('scaffold', () => {
  it('runs typescript under vitest', () => {
    const x: number = 1 + 1;
    expect(x).toBe(2);
  });
});
