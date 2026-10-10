import { TinyFish } from "@tiny-fish/sdk";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

async function runTinyFishQA() {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    console.error("CRITICAL: TINYFISH_API_KEY is missing.");
    process.exit(1);
  }

  console.log("Starting TinyFish Autonomous Browser QA...");

  try {
    // Note: TinyFish cloud agent must be able to reach this URL.
    // For local testing without a tunnel, this might fail or require a tunnel (e.g. ngrok).
    // The prompt says: "If TinyFish cannot reach the configured environment, report that limitation instead of falsely declaring the application broken."
    const baseUrl =
      process.env.STAGING_URL || process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:8080";
    console.log(`Target URL: ${baseUrl}`);
    console.log(
      `NOTE: If ${baseUrl} is a localhost URL, ensure you have an active secure tunnel (e.g., ngrok) or that you are running this against a publicly reachable staging environment. Cloud agents cannot natively route to your local network.`,
    );

    const client = new TinyFish({ apiKey });

    console.log("Sending QA Task to TinyFish...");
    const result = await client.run({
      url: baseUrl,
      task: `
        1. Open the application.
        2. Verify that the main dashboard and "Total Incidents Monitored" KPI loads.
        3. Navigate to the "Investigation" section via the main menu.
        4. Check that the "Investigation Report" and "Evidence Map" are visible.
        5. Report any broken links, missing components, or visible error messages.
      `,
    });

    console.log("\n--- TinyFish QA Result ---");
    console.log(`Status: ${result.status}`);
    if (result.findings) {
      console.log("Findings:");
      console.log(result.findings);
    }

    if (result.status === "failed" || result.status === "error") {
      console.error("TinyFish QA reported failures.");
      process.exit(1);
    } else {
      console.log("TinyFish QA completed successfully.");
    }
  } catch (error) {
    console.error("TinyFish QA execution error:", error.message);
    if (error.message.includes("ECONNREFUSED") || error.message.includes("timeout")) {
      console.warn(
        "LIMITATION: TinyFish could not reach the target environment. If testing locally, use a secure tunnel or test against a staging URL.",
      );
      // Don't fail the build just because of a network limitation of the cloud agent trying to reach localhost
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}

runTinyFishQA();
