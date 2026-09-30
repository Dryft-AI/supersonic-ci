# supersonic-ci

Skip a CI job when the files it depends on already passed that job, even if the run they passed in was later cancelled or had a different job fail.

Path filters answer "did this PR touch the backend?". Once the answer is yes, every push to the PR reruns the backend jobs, including pushes that only touched the frontend. [skip-duplicate-actions](https://github.com/fkirc/skip-duplicate-actions) goes further, but it only reuses a whole workflow run that finished green. A run you cancelled by pushing again, or one where a different job failed, doesn't count. So its passing jobs get rerun anyway.

supersonic-ci keeps a record per job instead. Each job's inputs get a hash. When the job passes, it saves a tiny cache entry under that hash. The next run looks the hash up and skips the job if the entry is there. It doesn't matter what happened to the rest of the old run.

```
push A   touches backend + frontend
         backend passes, records its hash
         frontend still running
push B   touches frontend only, cancels A
         backend: same hash as A's, record found, skipped
         frontend: new hash, runs
```

## Usage

Two actions. `check` runs once, early, and decides for every lane. `record` goes at the top of each job and saves the record when the job succeeds.

```yaml
jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      hashes: ${{ steps.check.outputs.hashes }}
      passed: ${{ steps.check.outputs.passed }}
    steps:
      - uses: actions/checkout@v4
      - id: check
        uses: Dryft-AI/supersonic-ci/check@v1
        with:
          lanes: |
            backend: [backend, common, .github/workflows/ci.yml]
            frontend: [frontend, .github/workflows/ci.yml]

  backend:
    needs: plan
    if: ${{ !fromJSON(needs.plan.outputs.passed).backend }}
    runs-on: ubuntu-latest
    steps:
      - uses: Dryft-AI/supersonic-ci/record@v1
        with:
          lane: backend
          hash: ${{ fromJSON(needs.plan.outputs.hashes).backend }}
      - uses: actions/checkout@v4
      - run: make test-backend
```

A skipped job reports `skipped`, which GitHub treats as passing for required checks.

## What goes into a hash

- `git ls-files --stage` over the lane's pathspecs, so the blob hash and mode of every tracked file under them. Pathspecs are plain git pathspecs: `backend`, `backend/**` and `*.py` all work.
- The pathspec list itself, the lane's `salt`, and the global `salt`.

Nothing else. The runner image, tool versions set outside the listed files, secrets and the time are not in the hash. Put anything that changes a job's outcome into its paths (the workflow file is usually one of them), or into a `salt`:

```yaml
lanes: |
  integration:
    paths: [backend, .github/workflows/integration.yml]
    salt: seed-${{ steps.filter.outputs.seed }}
```

A lane that matches no tracked files is an error. It logs a warning and the job runs, rather than every typo'd lane hashing to the same empty list.

## When a job skips

Only when `record` saved an entry for exactly this hash, and `record` only saves after every step in its job succeeded (`post-if: success()`). A failed or cancelled job saves nothing.

Everything that goes wrong fails open. A hash that can't be computed, a cache lookup that errors, or a cache service that isn't there all mean "run the job".

## Where records live

In the GitHub Actions cache, under `<key-prefix>-<lane>-<hash>`. GitHub's normal cache scoping applies. A pull request sees records from its own branch and from the base branch, but not from other pull requests. Entries unused for 7 days are evicted, and the repository's cache size limit applies. Each record is a single small file.

## What it doesn't do

It doesn't wait for a job that's still running on the same inputs in an earlier run. If you push while CI is running, a job whose inputs you didn't change reruns unless it had already finished and recorded. Keep your usual `concurrency` cancel settings. A cancelled job never records, so cancelling can't produce a false skip.

It doesn't know what a job reads. If your backend tests read a file outside the backend lane's paths, a change to that file won't rerun them. The lane paths are the whole contract.

## Inputs

`check`

| Input | Default | |
|---|---|---|
| `lanes` | required | YAML map of lane name to a list of pathspecs, or to `{paths, salt}` |
| `salt` | `""` | Mixed into every hash. Change it to invalidate every record |
| `key-prefix` | `supersonic-ci` | Cache key prefix |
| `working-directory` | `GITHUB_WORKSPACE` | Checkout to hash |

Outputs `hashes` and `passed` as JSON objects keyed by lane, and `<lane>-hash` and `<lane>-passed` for each lane.

`record`

| Input | Default | |
|---|---|---|
| `lane` | required | Lane name |
| `hash` | required | The lane's hash from `check`. Empty records nothing |
| `key-prefix` | `supersonic-ci` | Must match `check` |

## License

MIT
