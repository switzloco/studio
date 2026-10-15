/**
 * Side-effect module: load .env.local (then .env) into process.env.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });
config();
