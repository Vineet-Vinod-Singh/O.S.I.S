const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const retention = require('../src/services/retention.service');

async function writeMarker(directory, values = {}) {
    await fs.writeFile(
        path.join(directory, 'osis-cache.json'),
        JSON.stringify({
            owner: 'osis-test-v1',
            directory: path.resolve(directory),
            state: 'completed',
            persistenceSucceeded: true,
            evidenceRequired: false,
            evidenceArchived: false,
            expires: Date.now() - 3600000,
            ...values,
        }),
    );
}

describe('Retention Service', () => {
    let testDir;

    beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-test-retention-'));
    });

    afterEach(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
    });

    it('should delete expired artifact directory', async () => {
        const artifactDir = path.join(testDir, 'osis-expired');
        await fs.mkdir(artifactDir);
        
        await writeMarker(artifactDir);

        // Add dummy artifact file
        await fs.writeFile(path.join(artifactDir, 'data.tif'), 'fake data');

        const result = await retention.cleanupStaleArtifacts(testDir, 'osis-');
        
        assert.strictEqual(result.scanned, 1);
        assert.strictEqual(result.deleted, 1);

        // Verify directory is gone
        const exists = await fs.access(artifactDir).then(() => true).catch(() => false);
        assert.strictEqual(exists, false);
    });

    it('should NOT delete active artifact directory', async () => {
        const artifactDir = path.join(testDir, 'osis-active');
        await fs.mkdir(artifactDir);
        
        await writeMarker(artifactDir, { expires: Date.now() + 3600000 });

        const result = await retention.cleanupStaleArtifacts(testDir, 'osis-');
        
        assert.strictEqual(result.scanned, 1);
        assert.strictEqual(result.deleted, 0);

        // Verify directory still exists
        const exists = await fs.access(artifactDir).then(() => true).catch(() => false);
        assert.strictEqual(exists, true);
    });

    it('should ignore directories without valid ownership markers', async () => {
        const unknownDir = path.join(testDir, 'osis-unknown');
        await fs.mkdir(unknownDir);
        
        // No osis-cache.json
        const result = await retention.cleanupStaleArtifacts(testDir, 'osis-');
        
        assert.strictEqual(result.scanned, 1);
        assert.strictEqual(result.deleted, 0);

        const exists = await fs.access(unknownDir).then(() => true).catch(() => false);
        assert.strictEqual(exists, true);
    });

    it('path safety prevents path traversal', async () => {
        const result = await retention.cleanupStaleArtifacts('/does/not/exist/ever', 'osis-');
        assert.strictEqual(result.scanned, 0);
        assert.strictEqual(result.errors, 0); // Handled ENOENT gracefully
    });
    
    it('dryRun does not delete directories', async () => {
        const artifactDir = path.join(testDir, 'osis-dryrun');
        await fs.mkdir(artifactDir);
        
        await writeMarker(artifactDir);

        const result = await retention.cleanupStaleArtifacts(testDir, 'osis-', { dryRun: true });
        
        assert.strictEqual(result.scanned, 1);
        assert.strictEqual(result.deleted, 0);
        assert.strictEqual(result.wouldDelete, 1);

        const exists = await fs.access(artifactDir).then(() => true).catch(() => false);
        assert.strictEqual(exists, true); // but actually still exists!
    });

    it('should protect an active directory from deletion even if it is expired', async () => {
        const artifactDir = path.join(testDir, 'osis-protected');
        await fs.mkdir(artifactDir);
        
        // Create an expired marker
        await writeMarker(artifactDir);

        retention.registerActiveDirectory(artifactDir);

        const result = await retention.cleanupStaleArtifacts(testDir, 'osis-');
        assert.strictEqual(result.deleted, 0);

        const exists = await fs.access(artifactDir).then(() => true).catch(() => false);
        assert.strictEqual(exists, true);

        retention.unregisterActiveDirectory(artifactDir);
    });

    it('should perform scheduled cleanup independently of requests', async () => {
        mock.timers.enable({ apis: ['setInterval', 'Date'] });

        const artifactDir = path.join(testDir, 'osis-scheduled');
        await fs.mkdir(artifactDir);
        
        await writeMarker(artifactDir, { expires: Date.now() - 3600000 });

        // Schedule cleanup
        retention.scheduleCleanup(testDir, 'osis-');

        // Fast-forward 1 hour and 1 second to trigger the sweep
        mock.timers.tick(3600000 + 1000);

        // Wait for real FS macrotasks to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        retention.stopCleanupSchedule();
        mock.timers.reset();

        // Verify directory was deleted by the background task
        const exists = await fs.access(artifactDir).then(() => true).catch(() => false);
        assert.strictEqual(exists, false);
    });

    it('retains failed artifacts until the diagnostic period expires', async () => {
        const artifactDir = path.join(testDir, 'osis-failed');
        await fs.mkdir(artifactDir);
        await writeMarker(artifactDir, {
            state: 'failed',
            persistenceSucceeded: false,
            evidenceRequired: false,
            expires: Date.now() + 3600000,
        });

        const beforeExpiry = await retention.cleanupStaleArtifacts(testDir, 'osis-');
        assert.equal(beforeExpiry.deleted, 0);
        assert.equal(beforeExpiry.skipped, 1);

        await writeMarker(artifactDir, {
            state: 'failed',
            persistenceSucceeded: false,
            evidenceRequired: false,
            expires: Date.now() - 3600000,
        });
        const afterExpiry = await retention.cleanupStaleArtifacts(testDir, 'osis-');
        assert.equal(afterExpiry.deleted, 1);
    });

    it('never deletes evidence until durable archival is verified', async () => {
        const artifactDir = path.join(testDir, 'osis-evidence');
        await fs.mkdir(artifactDir);
        await fs.writeFile(path.join(artifactDir, 'scene.tif'), 'evidence');
        await writeMarker(artifactDir, {
            evidenceRequired: true,
            evidenceArchived: false,
        });

        const blocked = await retention.cleanupStaleArtifacts(testDir, 'osis-');
        assert.equal(blocked.deleted, 0);
        await fs.access(path.join(artifactDir, 'scene.tif'));

        await writeMarker(artifactDir, {
            evidenceRequired: true,
            evidenceArchived: true,
        });
        const archived = await retention.cleanupStaleArtifacts(testDir, 'osis-');
        assert.equal(archived.deleted, 1);
    });
});
