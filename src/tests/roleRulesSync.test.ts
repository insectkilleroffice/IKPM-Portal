import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseRoleOf, canEditModule, DEFAULT_ROLES, isEntomologistRole, setRoleDefinitions } from '../lib/permissions';

// The portal shows buttons from DEFAULT_ROLES (src/lib/permissions.ts); the server decides from
// defaultModulesFor() in firestore.rules. If the two disagree, a person sees a button and then gets
// "permission denied" (e.g. the Supervisor's Start Visit / Close Out). Keep them identical.
const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf-8');

function rulesModulesFor(roleId: string): Record<string, string> {
  const fn = rules.slice(rules.indexOf('function defaultModulesFor(r)'), rules.indexOf('function roleModules()'));
  const re = new RegExp(`r == '${roleId}'[^?]*\\?\\s*\\{([^}]*)\\}`);
  const body = re.exec(fn)?.[1];
  if (!body) throw new Error(`firestore.rules has no default modules for '${roleId}'`);
  return Object.fromEntries([...body.matchAll(/'([a-z_]+)'\s*:\s*'([a-z]+)'/g)].map((m) => [m[1], m[2]]));
}

describe('role permissions: portal and server rules match', () => {
  DEFAULT_ROLES.filter((r) => r.id !== 'super_admin').forEach((role) => {
    it(`${role.name} (${role.id})`, () => {
      const portal = Object.fromEntries(Object.entries(role.modules).filter(([, v]) => v && v !== 'none'));
      expect(rulesModulesFor(role.id)).toEqual(portal);
    });
  });

  it('the Entomologist works as a CRO and also does audits, even with an older saved role record', () => {
    const cro = DEFAULT_ROLES.find((r) => r.id === 'sales')!;
    setRoleDefinitions([{ id: 'entomologist', name: 'Entomologist', basedOn: 'entomologist' as never, isSystem: true, defaultScope: 'own', modules: { audits: 'edit', company_files: 'view' } }]);
    expect(baseRoleOf('entomologist')).toBe('sales');
    expect(canEditModule('entomologist', 'audits')).toBe(true);
    Object.entries(cro.modules).forEach(([m, level]) => {
      if (level === 'edit') expect(canEditModule('entomologist', m as never)).toBe(true);
    });
    expect(isEntomologistRole('entomologist')).toBe(true);
    expect(isEntomologistRole('sales')).toBe(false);
    setRoleDefinitions([]);
  });

  it('old role ids resolve to the current roles on the server too', () => {
    expect(rules).toMatch(/r == 'operations_coordinator' \? 'team_leader'/);
    expect(rules).toMatch(/r == 'operations_manager' \? 'operations'/);
    expect(rules).toMatch(/roles\/\$\(rk == '' \? '_none' : rk\)/);
  });
});
