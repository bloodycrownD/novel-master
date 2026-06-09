#!/usr/bin/env node
/**
 * Inject tool-turn E2E fixture via host-side SQLite (no sqlite3 binary on device).
 *
 * 1. Pull app DB with adb exec-out run-as
 * 2. Apply fixture SQL with Node built-in sqlite (Node 22+)
 * 3. Push modified DB back into app sandbox
 *
 * Prerequisite: launch debug app once so the DB file exists.
 */
import {DatabaseSync} from 'node:sqlite';
import {execFileSync, execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = 'com.novelmaster';
const DB_REL = 'files/default/novel_master_vfs';
const DB_DEVICE = `/data/data/${PKG}/${DB_REL}`;
const SQL_PATH = path.join(__dirname, '..', 'fixtures', 'tool-turn-session.sql');

function adb(...args) {
  return execFileSync('adb', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
}

function adbShell(cmd) {
  return execSync(`adb shell ${cmd}`, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
}

function main() {
  if (!fs.existsSync(SQL_PATH)) {
    throw new Error(`Fixture SQL not found: ${SQL_PATH}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-e2e-'));
  const localDb = path.join(tmpDir, 'novel_master_vfs');
  const remoteTmp = '/data/local/tmp/nm-e2e-fixture.db';

  try {
    console.log(`[e2e] Force-stopping ${PKG}...`);
    adb('shell', 'am', 'force-stop', PKG);

    console.log(`[e2e] Pulling ${DB_DEVICE}...`);
    let pulled;
    try {
      pulled = execSync(`adb exec-out run-as ${PKG} cat ${DB_REL}`, {
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      throw new Error(
        'Could not read app database. Launch the debug app once (creates SQLite), then re-run.',
      );
    }
    if (!pulled?.length) {
      throw new Error('Pulled database is empty — open the app once before injecting.');
    }
    fs.writeFileSync(localDb, pulled);

    console.log('[e2e] Applying fixture SQL on host...');
    const sql = fs.readFileSync(SQL_PATH, 'utf8');
    const db = new DatabaseSync(localDb);
    db.exec(sql);
    db.close();

    console.log('[e2e] Pushing database back to device...');
    adb('push', localDb, remoteTmp);
    // run-as cwd is app data dir; source is world-readable /data/local/tmp on debug builds.
    adbShell(`run-as ${PKG} cp ${remoteTmp} ${DB_REL}`);
    adbShell(`rm -f ${remoteTmp}`);

    console.log(
      "[e2e] Fixture injected. Launch app and open session 'E2E Tool Turn Fixture'.",
    );
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
}

main();
