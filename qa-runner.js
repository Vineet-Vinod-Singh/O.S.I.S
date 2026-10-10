const { spawn } = require('child_process');
const http = require('http');

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
        } else {
          retry();
        }
      }).on('error', retry);
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for ${url}`));
      } else {
        setTimeout(check, 1000);
      }
    };
    check();
  });
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`\n\x1b[36m> Running: ${command} ${args.join(' ')} in ${cwd}\x1b[0m`);
    const proc = spawn(command, args, { cwd, stdio: 'inherit', shell: true });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

async function main() {
  console.log('\x1b[1m\x1b[32m=== O.S.I.S. Autonomous QA Runner ===\x1b[0m');
  
  // 1. Run Backend Tests
  console.log('\n\x1b[1m--- Phase 1: Backend Tests ---\x1b[0m');
  try {
    await runCommand('npm', ['run', 'test'], './backend');
  } catch (e) {
    console.error('\x1b[31mBackend tests failed!\x1b[0m');
    process.exit(1);
  }

  // 2. Run Frontend Tests
  console.log('\n\x1b[1m--- Phase 2: Frontend Tests ---\x1b[0m');
  try {
    await runCommand('npm', ['run', 'test'], './frontend');
  } catch (e) {
    console.error('\x1b[31mFrontend tests failed!\x1b[0m');
    process.exit(1);
  }

  console.log('\n\x1b[1m--- Phase 3: Browser QA (Playwright) ---\x1b[0m');
  try {
    process.env.PLAYWRIGHT_TEST_BASE_URL = 'http://localhost:8081';
    await runCommand('npx', ['playwright', 'test'], './frontend');
  } catch (e) {
    console.error('\x1b[31mBrowser tests failed!\x1b[0m');
    process.exit(1);
  }
  
  console.log('\n\x1b[1m--- Phase 4: TinyFish Web Agent ---\x1b[0m');
  if (process.env.TINYFISH_API_KEY || process.env.RUN_TINYFISH) {
    try {
      await runCommand('node', ['tinyfish-qa.js'], './frontend');
    } catch (e) {
      console.error('\x1b[31mTinyFish QA failed!\x1b[0m');
      process.exit(1);
    }
  } else {
    console.log('\x1b[33mSkipping TinyFish QA. Set TINYFISH_API_KEY to run.\x1b[0m');
  }

  console.log('\n\x1b[1m\x1b[32m=== All QA Checks Passed Successfully ===\x1b[0m');
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
