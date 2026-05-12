import { config } from 'dotenv';
config({ path: '.env.local' });
import { ai } from './src/ai/genkit';

async function run() {
  console.log('Testing gemini-3.1-flash...');
  try {
    const { text } = await ai.generate('hello');
    console.log('Success! Model replied:', text);
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}
run();
