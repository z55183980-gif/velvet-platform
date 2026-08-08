# yt-dlp source-site auth (cookies / bearer)

Put Netscape cookie files under:

`{STORAGE_ROOT}/secrets/cookies/{hostname}.txt`

Examples: `reelshort.com.txt`, `www.example.com.txt`

Env (services/api/.env):

```
# Global cookie file (all hosts)
YTDLP_COOKIES_FILE=

# Override cookies directory (default STORAGE_ROOT/secrets/cookies)
YTDLP_COOKIES_DIR=

# Authorization: Bearer …
YTDLP_AUTH_BEARER=

# Extra headers, newline or || separated — e.g. Cookie: a=b||X-Api-Key: k
YTDLP_ADD_HEADERS=
```

Admin API optional body fields on probe/resolve/import/append/transfer/download:

- `cookiesFile` — basename under cookies dir (e.g. `reelshort.com.txt`)
- `authBearer` — one-shot Bearer token

Export cookies from a logged-in browser (extension: Get cookies.txt LOCALLY), save as `{host}.txt`, then probe/import as usual. Never commit real cookie files.
