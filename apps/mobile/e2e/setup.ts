/**
 * WDIO worker setup — register expect matchers once per worker process.
 * Do not import expect-webdriverio from wdio.conf.ts (config loads twice → "Cannot redefine property: soft").
 */
import 'expect-webdriverio';
