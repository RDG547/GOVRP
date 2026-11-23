// Only for freshly created, disposable test databases. Production SQL files
// are never rewritten. Clock primitives alone are rebound for long simulations.
export const withTestClock=sql=>sql
  .replace(/\b(?:pg_catalog\.)?(?:statement_timestamp|clock_timestamp|now)\s*\(\s*\)/gi,'qa_clock.clock()')
  .replace(/\bcurrent_date\b/gi,'qa_clock.operation_day()');

export async function installStructuralTestClock(db,iso) {
  await db.query("SELECT set_config('qa.clock',$1,false)",[iso]);
  await db.exec(`CREATE SCHEMA qa_clock;
    CREATE FUNCTION qa_clock.clock() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT current_setting(''qa.clock'')::timestamptz';
    CREATE FUNCTION qa_clock.operation_day() RETURNS date LANGUAGE sql STABLE AS 'SELECT (qa_clock.clock() AT TIME ZONE ''America/Sao_Paulo'')::date';`);
  const functions=(await db.query(`SELECT pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private','economy_private') AND p.prokind='f'`)).rows;
  for(const f of functions){const mapped=withTestClock(f.definition);if(mapped!==f.definition)await db.exec(mapped);}
  const defaults=(await db.query(`SELECT table_schema,table_name,column_name,column_default FROM information_schema.columns
    WHERE table_schema IN ('public','private','economy_private') AND column_default IS NOT NULL`)).rows;
  const ident=s=>'"'+s.replaceAll('"','""')+'"';
  for(const d of defaults){const mapped=withTestClock(d.column_default);if(mapped!==d.column_default)await db.exec(
    `ALTER TABLE ${ident(d.table_schema)}.${ident(d.table_name)} ALTER COLUMN ${ident(d.column_name)} SET DEFAULT ${mapped}`);}
}
