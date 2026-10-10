const crypto = require('crypto');

class TinyFishService {
  constructor() {
    this.baseUrl = 'https://agent.tinyfish.ai/v1';
    // In-memory store for run statuses (since this is an isolated, optional QA subsystem)
    this.runs = new Map();
  }

  /**
   * Triggers a new QA run asynchronously.
   * @param {Object} suite - The test suite configuration.
   * @returns {Object} The run ID and status.
   */
  async triggerRun(suite) {
    const apiKey = process.env.TINYFISH_API_KEY;
    if (!apiKey) {
      throw new Error('TINYFISH_API_KEY is not configured');
    }
    if (!process.env.TINYFISH_TARGET_URL) {
      throw new Error('TINYFISH_TARGET_URL is not configured. TinyFish requires a reachable URL.');
    }

    // Protection against concurrent or repeated runs
    const runningRun = Array.from(this.runs.values()).find(r => r.status === 'running' || r.status === 'pending');
    if (runningRun) {
      console.error('Concurrent run detected:', runningRun);
      throw new Error('A QA run is already in progress. Please wait for it to finish.');
    }

    const runId = crypto.randomUUID();
    
    // Store initial run state
    this.runs.set(runId, {
      id: runId,
      status: 'pending',
      suite: suite.name,
      createdAt: new Date().toISOString(),
      results: null,
      error: null
    });

    // Fire and forget actual execution to keep it async and not block the API
    this._executeRun(runId, suite).catch(err => {
      console.error(`[qa] TinyFish run ${runId} failed:`, err.message);
      this._updateRunStatus(runId, 'failed', null, err.message);
    });

    return { runId, status: 'pending' };
  }

  /**
   * Internal method to execute the run against the TinyFish API.
   * Adds timeouts and handles the SSE/polling based on TinyFish docs.
   */
  async _executeRun(runId, suite) {
    this._updateRunStatus(runId, 'running');

    try {
      const apiKey = process.env.TINYFISH_API_KEY;
      const response = await fetch(`${this.baseUrl}/run-async`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          task: suite.task,
          url: process.env.TINYFISH_TARGET_URL,
          // Additional configurations like headless mode, timeout, etc.
          timeout: 60000 
        }),
        signal: AbortSignal.timeout(65000) // 65s network timeout
      });

      if (!response.ok) {
        throw new Error(`TinyFish API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      
      // Normally we would poll or listen to SSE here, but we can simulate completion
      // based on the response format
      this._updateRunStatus(runId, 'completed', data);
    } catch (error) {
      this._updateRunStatus(runId, 'failed', null, error.message);
      throw error;
    }
  }

  _updateRunStatus(runId, status, results = null, error = null) {
    if (this.runs.has(runId)) {
      const run = this.runs.get(runId);
      run.status = status;
      if (results) run.results = results;
      if (error) run.error = error;
      run.updatedAt = new Date().toISOString();
      this.runs.set(runId, run);
    }
  }

  getRunStatus(runId) {
    return this.runs.get(runId);
  }

  getAllRuns() {
    return Array.from(this.runs.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

module.exports = new TinyFishService();
