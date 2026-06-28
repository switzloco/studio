/**
 * Side-effect module: load .env.local (then .env) into process.env.
 *
 * This MUST be the very first import in every eval entrypoint. @/ai/genkit
 * initializes Arize Phoenix at import time and reads PHOENIX_ENABLED *then*, and
 * ES module imports are evaluated before any other top-level code — so dotenv
 * has to run via an import that precedes the genkit import, not via a plain
 * config() call sitting below the imports (which runs too late).
 */
import { config } from 'dotenv';

config({ path: '.env.local' });
config();
