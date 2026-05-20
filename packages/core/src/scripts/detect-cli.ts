import { detectAgents } from '../agents/detect.js';

const detected = await detectAgents();
if (detected.length === 0) {
  console.log('No supported agents found on PATH.');
  process.exit(1);
}
console.log(`Detected ${detected.length} agent${detected.length === 1 ? '' : 's'}:`);
for (const d of detected) {
  console.log(`  ${d.descriptor.id.padEnd(10)} ${d.binPath}`);
}
