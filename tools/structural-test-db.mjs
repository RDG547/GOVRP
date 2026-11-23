import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';

export async function createStructuralTestDatabase() {
  const address=process.env.GOVRP_TEST_DATABASE_URL;
  if(!address)return new PGlite();
  const url=new URL(address);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname!=='/postgres'){
    throw Error('Native tests require an explicit loopback /postgres maintenance connection. Remote databases are forbidden.');
  }
  const name='govrp_qa_structural_'+randomUUID().replaceAll('-','');
  const maintenance=new pg.Client({connectionString:address});await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);
  url.pathname='/'+name;
  const client=new pg.Client({connectionString:url.href});await client.connect();
  return {
    exec:sql=>client.query(sql),query:(sql,values)=>client.query(sql,values),
    connect:async()=>{const extra=new pg.Client({connectionString:url.href});await extra.connect();return extra;},
    close:async()=>{await client.end();await maintenance.query(`DROP DATABASE "${name}" WITH (FORCE)`);await maintenance.end();},
  };
}
