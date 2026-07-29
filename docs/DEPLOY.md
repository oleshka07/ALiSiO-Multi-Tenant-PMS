# Deployment

Two environments on one VPS, one nginx, one image, two isolated stacks.

| | Branch | Port | Volume | URL |
|---|---|---|---|---|
| Production | `main` | 3130 | `alisio-prod_app-data` | `https://<domain>` |
| Beta | `beta` | 3131 | `alisio-beta_app-data` | `https://beta.<domain>` |

Separate compose projects mean separate volumes: **beta cannot read or write
production's database.** That is the point of having it.

## First-time server setup

```bash
git clone <repo> /opt/alisio && cd /opt/alisio
sudo ./deploy/setup-vps.sh pms.example.com admin@example.com
```

Installs Docker, nginx, certbot and a firewall; issues certificates for the
domain and its `beta.` subdomain. Both A records must already point at the host.

Then create the two environment files — they are gitignored and never committed:

```bash
cp deploy/env.prod.example deploy/env.prod
cp deploy/env.beta.example deploy/env.beta
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put a **different** `APP_SECRET_KEY` in each. It encrypts integration
credentials stored in the database (Telegram token, IMAP passwords), so a leak
from staging must not decrypt production. Losing the production key makes those
credentials unrecoverable — back it up somewhere other than the server.

## The flow

```
work → merge into beta → ./deploy/deploy.sh beta → check on beta.<domain>
                       → merge into main → ./deploy/deploy.sh prod
```

```bash
git checkout beta && git merge --no-ff feature/x && git push origin beta
ssh server 'cd /opt/alisio && ./deploy/deploy.sh beta'
# verify, then:
git checkout main && git merge --no-ff beta && git push origin main
ssh server 'cd /opt/alisio && ./deploy/deploy.sh prod'
```

`deploy.sh` refuses to run without a valid 64-hex `APP_SECRET_KEY`, archives the
data volume to `deploy/backups/` before touching anything, rebuilds, and waits
for the app to answer. If it does not come up within 60 seconds it prints the
container logs and exits non-zero.

## Rollback

```bash
git checkout main && git reset --hard <previous-sha> && git push --force-with-lease
./deploy/deploy.sh prod
```

To restore the database as well:

```bash
docker compose --env-file deploy/env.prod -p alisio-prod -f deploy/docker-compose.yml down
docker run --rm -v alisio-prod_app-data:/data -v "$PWD/deploy/backups:/b" \
  alpine sh -c 'rm -rf /data/* && tar xzf /b/alisio-prod-<stamp>.tar.gz -C /data'
./deploy/deploy.sh prod
```

## Beta data

Beta starts empty and seeds the demo tenant. To reproduce a production problem,
copy the backup across — and remember it then holds real guest data, which is
why the beta host is served with `X-Robots-Tag: noindex` and sits behind the
same login.

## Known limits

- The database is still SQLite in a volume; the Postgres migration is Phase 1.
  Until then the two environments are two files, not two database servers.
- Backups are local to the server. Copy `deploy/backups/` off-host — a disk
  failure currently takes the backups with it.
