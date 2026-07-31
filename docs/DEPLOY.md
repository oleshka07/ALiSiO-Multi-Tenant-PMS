# Deployment

Two environments on one VPS, one nginx, one image, two isolated stacks.

| | Branch | Port | Volume | URL |
|---|---|---|---|---|
| Production | `main` | 3130 | `alisio-prod_app-data` | `https://<domain>` |
| Beta | `beta` | 3131 | `alisio-beta_app-data` | `https://beta.<domain>` |

Separate compose projects mean separate volumes: **beta cannot read or write
production's database.** That is the point of having it.

## First-time server setup

**Pick the right script. The wrong one takes other projects on the host
offline.**

### The host serves nothing else

```bash
git clone <repo> /opt/alisio && cd /opt/alisio
sudo ./deploy/setup-vps.sh pms.example.com admin@example.com
```

Installs Docker, nginx and certbot, enables ufw with SSH + nginx as the only
open ports, removes nginx's default site, then hands over to `add-site.sh` for
the server blocks and certificates.

`setup-vps.sh` refuses to run if it sees other sites in `sites-enabled`, an
already-active ufw, or running Docker containers. That guard exists because
`ufw --force enable` closes every port the other projects listen on directly,
and reinstalling nginx restarts it for everyone. Override with
`ALISIO_FORCE_SETUP=1` only if you are certain the detection is wrong.

### The host already runs other projects

This is the usual case. Install nginx, certbot and Docker yourself — or confirm
they are there — and then:

```bash
git clone <repo> /opt/alisio && cd /opt/alisio
sudo ./deploy/add-site.sh pms.example.com admin@example.com
```

`add-site.sh` only ever writes `/etc/nginx/snippets/alisio-proxy.conf`, one
server-block file for this domain, and requests certificates for `<domain>` and
`beta.<domain>` with `--cert-name` so an existing certificate is untouched. It
does not install packages, does not touch the firewall, does not remove the
default site, and refuses to overwrite a server-block file it did not write
itself.

Both A records — `<domain>` and `beta.<domain>` — must resolve to this host
before you run it. The script checks and stops if they do not: certbot's
HTTP-01 challenge would fail, leaving a server block that references
certificates which do not exist, and then `nginx -t` fails and the next reload
takes **every** site on the box down.

### What is running here now

`alisio.rozum.one` and `beta.alisio.rozum.one` share a VPS with several
unrelated projects (rozum, socialio, systemator, holos, goto). nginx there
already serves eight sites and ufw is already configured. On that host, only
`add-site.sh` is safe — `setup-vps.sh` will refuse, which is the intended
behaviour.

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
