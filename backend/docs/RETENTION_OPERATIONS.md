# Retention and storage-capacity operations

## Storage policy

- `OSIS_MAX_REPORTS` remains a hard ceiling of 100 active incident JSON files.
- At/above that ceiling, a new report can be written to `OSIS_REPORT_ARCHIVE_DIR`
  only after its PostgreSQL mirror succeeds. The archive writes a versioned
  report copy, verifies its SHA-256 checksum, then records the incident ID,
  source scene ID, source path, evidence references, checksum, and archive
  status in `manifest.json`. Repeating the same export is idempotent. Concurrent
  exports are serialized by an exclusive manifest lock.
- If the directory already contains more than 100 reports, existing files are
  left untouched. New admissions are identified as `verified_archive` and are
  accepted only while PostgreSQL and the writable archive are available;
  otherwise status is `paused`. This distinguishes the available overflow
  route from remaining local report capacity.
- Existing reports are never moved or deleted automatically. Verified archive
  copies do not trigger source deletion. Demo reports are marked protected.
- PostgreSQL remains the historical incident/outcome store when
  `OSIS_PERSIST_POSTGRES=true`. If persistence or local archive access fails,
  the worker and discovery stop admitting work instead of marking a scene
  processed or advancing the poller checkpoint.
- `backend/data/scenes` holds downloaded VV/VH rasters referenced from
  `processed_scenes.artifact_metadata`. The worker no longer sweeps this
  directory. Temp CDSE/upload directories are marker-owned, but deletion also
  requires successful persistence and either an explicitly non-evidence
  classification or verified durable evidence archival. Failed non-evidence
  artifacts are retained for `OSIS_FAILED_ARTIFACT_RETENTION_HOURS` before
  cleanup. The diagnostic period is not a force-delete TTL: raw rasters remain
  protected past it until separately archived.
- Local report archive directories and local scene directories are not a
  substitute for cloud-durable evidence.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OSIS_MAX_REPORTS` | 100 (hard maximum) | Maximum active JSON report count; cannot be raised above 100. |
| `OSIS_REPORT_DIR` | `backend/data/incidents` | Active local incident reports. |
| `OSIS_REPORT_ARCHIVE_DIR` | `backend/data/incidents_archive` | Checksummed local overflow archive. Keep separate from the active directory. |
| `OSIS_PERSIST_POSTGRES` | `false` | Must be `true` for report overflow archiving and durable incident history. |
| `OSIS_OBJECT_STORAGE_PROVIDER` | `local` | `local` keeps existing filesystem behavior; `supabase` enables verified cloud uploads and requires PostgreSQL persistence. |
| `OSIS_OBJECT_STORAGE_LOCAL_DIR` | `backend/data/object_storage` | Optional local adapter directory for isolated development/testing. |
| `OSIS_SUPABASE_URL` | unset | Supabase project HTTPS URL. Required for `supabase`. |
| `OSIS_SUPABASE_STORAGE_BUCKET` | unset | Private Supabase Storage bucket name. Required for `supabase`. |
| `OSIS_SUPABASE_SERVICE_ROLE_KEY` | unset | Supabase service-role secret. Required for `supabase`; configure it through the deployment secret manager, never a tracked file. |
| `OSIS_MIN_FREE_SPACE_MIB` | 1024 | Pause download/discovery below this free-space threshold. |
| `OSIS_SCENES_DIR` | `backend/data/scenes` | Raw scene raster directory; local storage only. |
| `OSIS_ARTIFACT_RETENTION_HOURS` | 72 | Default ownership-marker retention period. |
| `OSIS_FAILED_ARTIFACT_RETENTION_HOURS` | 168 | Diagnostic window for failed processing artifacts. |

`DATABASE_URL` must point to the intended PostgreSQL/PostGIS database. Never put
credentials in logs or command output. Place both report directories and scene
storage on an explicitly persistent filesystem for local/server deployments.
Do not set the report archive to the same path as the active report directory.

## Dry-run before any cleanup

From `backend`, run:

```powershell
npm run retention:dry-run
```

The command performs read-only filesystem scans and `SELECT` queries. It reports
report classifications, PostgreSQL references, archive checksum status, scene
and raster counts/bytes, eligible temporary cleanup candidates, and estimated
reclaimable bytes. It never moves, archives, or deletes anything. If database
classification fails, reports and evidence stay protected.

Review the entire classification before any operator-approved archive or
cleanup. A JSON filename or age alone is never sufficient grounds for deletion.
Demo records, reports not mirrored to PostgreSQL, unverified archive copies,
database-referenced rasters, and unknown files are not disposable. Keep the
dry-run output with the change record.

## Monitoring and recovery

Inspect:

- `GET /api/worker/status` for free-space threshold, report count, archive
  availability, and the current pause reason.
- `GET /api/ingestion/status` for poller storage state, queue counts, and the
  persisted checkpoint.

For `low_free_space`, add/free capacity on the configured persistent volume,
then verify `freeBytes >= minimumFreeBytes`. Do not delete scene files or
reports to recover space without a reviewed dry-run and explicit operator
approval.

For `report_capacity`, verify PostgreSQL connectivity, confirm
`OSIS_PERSIST_POSTGRES=true`, and make sure the archive directory exists and is
writable. Retry only after `/api/worker/status` returns `ready`. The scene row
remains queued and the discovery checkpoint is not advanced while paused.

For `database_unavailable`, restore the database before resuming ingestion.
For `archive_*` errors, preserve all source files and repair archive-volume
availability before retrying. Never clear queue rows or scene caches to make
the status appear healthy. For `archive_busy`, first verify no OSIS process is
currently writing the archive. If the process terminated unexpectedly and the
lock is confirmed stale, remove only `OSIS_REPORT_ARCHIVE_DIR/.manifest.lock`;
never remove the manifest or archived report files to clear the lock.

## Cloud evidence storage

The adapter supports a local filesystem provider and Supabase Storage. Supabase
was selected because OSIS already uses Supabase PostgreSQL; the adapter uses
the Storage REST API and introduces no SDK dependency. No bucket credentials
are configured in this repository. Cloud mode is explicit: set
`OSIS_OBJECT_STORAGE_PROVIDER=supabase`, configure every `OSIS_SUPABASE_*`
variable above, and set `OSIS_PERSIST_POSTGRES=true`. Missing or invalid
configuration pauses admission. Uploads use create-only keys derived from
hashed report/scene identities and artifact roles. An upload is complete only
after read-back verifies size and SHA-256. A retry accepts an existing object
only when its checksum matches; it never overwrites an object to resolve a
conflict.

The existing PostgreSQL incident `report` JSON and
`processed_scenes.artifact_metadata` store durable object references after
verification. The local report archive manifest also records references when
reports overflow. Local report and SAR files are retained on upload,
verification, or reference-persistence failure. This integration does not
enable cleanup or local evidence deletion. Keep the bucket private and apply
encryption, access controls, backups, and a retention policy appropriate to the
deployment.

Configure the service-role key through the deployment secret manager and expose
it to the backend as `OSIS_SUPABASE_SERVICE_ROLE_KEY`; do not put it in source
control, frontend configuration, logs, or API responses. This adapter does not
provide a Supabase workload-identity setting: deployments requiring managed
identity should securely inject the service-role secret. Do not configure
guessed `AWS_*`, Azure, or GCS variables and assume they take effect.

### Real-provider smoke test

Cloud readiness remains **NOT YET GO** until this succeeds against the actual
private bucket and a separate test database:

1. Apply the existing migrations to an isolated test database and create a
   private bucket. Confirm backend HTTPS connectivity. Do not use production
   incidents or scenes.
2. Set `OSIS_OBJECT_STORAGE_PROVIDER=supabase`,
   `OSIS_PERSIST_POSTGRES=true`, `OSIS_SUPABASE_URL`,
   `OSIS_SUPABASE_STORAGE_BUCKET`, and
   `OSIS_SUPABASE_SERVICE_ROLE_KEY` through the deployment secret/config
   mechanism. Restart the backend and confirm `GET /api/worker/status` reports
   the configured provider and an accepting storage state.
3. In that test database only, insert a test incident and a
   `processed_scenes` row with a unique scene identity. Put small VV/VH test
   rasters in an isolated temporary directory.
4. From a temporary backend-only test harness, call the exported
   `persistReportArtifacts` with that incident, the two local raster paths, and
   the test `processed_scenes.id`. Build its adapter with
   `createSupabaseAdapter` and the configured Supabase values. Confirm the
   result contains only object keys/checksums (no URLs or credentials), then
   independently download the private objects through a trusted operator
   client and compare exact sizes and hashes. Do not log request headers or
   private URLs.
5. For failure recovery, wrap the test harness's `fetchImpl` so it forwards
   object POSTs to the real test bucket but returns a simulated HTTP 503 for
   each POST response. Confirm retries exhaust without database references and
   both local raster files remain. Retry the same report and scene identity
   with normal `fetch`; create-only conflicts must be accepted only after
   actual read-back matches, after which both existing database metadata
   structures should contain the references. Preserve test records/objects
   for review; do not run this against live data.

Mocked-provider tests do not substitute for this real bucket, read-back,
database-reference, and failure-recovery smoke test. Until it passes,
continuous global ingestion is **NOT YET GO**. Local evidence remains
authoritative and will continue to consume disk.
