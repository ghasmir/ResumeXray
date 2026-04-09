const { validateResumeIntegrity, detectSections } = require('./lib/sections');
const { runAgentPipeline } = require('./lib/agent-pipeline');

const loremIpsum = `
Sample PDF
This is a simple PDF file. Fun fun fun.
Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Phasellus facilisis odio sed mi.
Curabitur suscipit. Nullam vel nisi. Etiam semper ipsum ut lectus. Proin aliquam, erat eget
pharetra commodo, eros mi condimentum quam, sed commodo justo quam ut velit.
Integer a erat. Cras laoreet ligula cursus enim. Aenean scelerisque velit et tellus.
Vestibulum dictum aliquet sem. Nulla facilisi. Vestibulum accumsan ante vitae elit. Nulla
erat dolor, blandit in, rutrum quis, semper pulvinar, enim. Nullam varius congue risus.
Vivamus sollicitudin, metus ut interdum eleifend, nisi tellus pellentesque elit, tristique
accumsan eros quam et risus. Suspendisse libero odio, mattis sit amet, aliquet eget,
hendrerit vel, nulla. Sed vitae augue. Aliquam erat volutpat. Aliquam feugiat vulputate nisl.
Suspendisse quis nulla pretium ante pretium mollis. Proin velit ligula, sagittis at, egestas a,
pulvinar quis, nisl.
`;

const jd = "Software Engineer with experience in Node.js and React.";

async function test() {
  console.log("--- Testing Integrity Logic ---");
  const sectionData = detectSections(loremIpsum);
  const integrity = validateResumeIntegrity(loremIpsum, sectionData);
  
  console.log("Integrity Score:", integrity.score);
  console.log("Is Resume:", integrity.isResume);
  console.log("Issues:", integrity.issues);

  if (!integrity.isResume) {
    console.log("✅ SUCCESS: Garbage document correctly rejected.");
  } else {
    console.log("❌ FAILURE: Garbage document incorrectly accepted.");
  }

  console.log("\n--- Testing Pipeline Speed (Simulation) ---");
  const emitter = {
    emitStep: (s, n, st, l, d) => console.log(`Step ${s} [${n}]: ${st} - ${l}`),
    emitScores: (s) => console.log("Scores updated:", s),
    emitError: (m) => console.log("Expected Error:", m),
    emitToken: () => {},
    emitBullet: () => {},
    emitComplete: () => {}
  };

  const results = await runAgentPipeline(loremIpsum, jd, emitter);
  console.log("\nMatch Rate:", results.matchRate);
  if (results.matchRate < 5) {
    console.log("✅ SUCCESS: Semantic match is strictly low for garbage.");
  } else {
    console.log("❌ FAILURE: Semantic match still too high for garbage.");
  }
}

test();
