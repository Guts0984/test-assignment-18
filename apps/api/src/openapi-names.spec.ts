import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const controllers = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return controllers(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });

describe('DTO class names', () => {
  // The OpenAPI document keys schemas by class name: two meanings of one name silently
  // overwrite each other, and the generated client gets the wrong type.
  it('stand for one schema each', () => {
    const schemas = new Map<string, Set<string>>();
    for (const file of controllers(__dirname)) {
      const source = readFileSync(file, 'utf8');
      const matches = source.matchAll(
        /class (\w+Dto) extends createZodDto\(\s*([\s\S]*?),?\s*\) \{\}/g,
      );
      for (const [, name = '', schema = ''] of matches) {
        const seen = schemas.get(name) ?? new Set<string>();
        schemas.set(name, seen.add(schema.replace(/\s+/g, '')));
      }
    }
    expect(schemas.size).toBeGreaterThan(40);
    expect([...schemas].filter(([, seen]) => seen.size > 1).map(([name]) => name)).toEqual([]);
  });
});
