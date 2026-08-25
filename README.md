# TanStarter CLI

English | [简体中文](README.zh-CN.md)

Create a production-ready TanStarter app from the template and deploy it to Cloudflare Workers in about 10 minutes.

## Quick Start

This repository is used from source, not from npm. Build it and link it once:

```bash
git clone https://github.com/akfc58/tanstarter-cli.git
cd tanstarter-cli
pnpm install
pnpm build
npm link
```

Then go to the directory where you want the new project to live and run:

```bash
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."


# Optional: enable Waffo payments during setup
export WAFFO_MERCHANT_ID="MER_..."
export WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."

npx tanstarter-cli@latest create
```

TanStarter CLI will ask for the project name, preset, resource names, and payment method before creating anything. When you pick Waffo, it also creates a Waffo store, the three template products, and the webhook automatically.


## Install

### Global command (recommended)

`npm link` symlinks `dist/index.js` into your npm global bin, so `tanstarter` is available everywhere:

```bash
pnpm build
npm link

tanstarter --version
```

After changing anything under `src/`, run `pnpm build` again. The linked command points at `dist/`, so it picks up the new build without relinking.

To remove the link:

```bash
npm unlink -g tanstarter-cli
```

`pnpm link --global` works too, but it fails with `ERR_PNPM_NO_GLOBAL_BIN_DIR` until you have run `pnpm setup` once.

### Run from source

Skip the build step while iterating on the CLI itself:

```bash
pnpm dev create
pnpm dev --help
```

`pnpm dev` runs `tsx src/index.ts`. Do not insert `--` before the flags: `pnpm dev -- --help` passes `--` through to the CLI and fails with `Unknown option: --`.

### Run the build output directly

```bash
pnpm build
node /path/to/tanstarter-cli/dist/index.js create
```

## Commands

```bash
tanstarter create [options]
tanstarter delete <project-name> [options]
tanstarter create <project-name> --resume
```

Options:

- `--domain <domain>`: configure a Cloudflare custom domain route.
- `--payment <none|waffo>`: payment method for the generated project. With `waffo`, the CLI uses the template's built-in monthly, yearly, and lifetime products, then creates the Waffo store, products, and webhook during setup.
- `--preset <free|account|full>`: site tier of the generated project. Defaults to `full`; when omitted in an interactive terminal, the CLI asks and Enter accepts `full`. See [Presets](#presets).
- `--repo <owner/name>`: create this GitHub repository. If omitted, TanStarter CLI defaults to the current GitHub CLI login and project name, for example `open-fox/my-app`.
- `--resume`: continue a failed setup from `.tanstarter/state.json`.
- `-h, --help`: show help.
- `-v, --version`: show version.

Example:

```bash
tanstarter create --domain app.example.com --repo mkfasthq/my-app
```

If a run fails after the project directory is created, fix the issue and run:

```bash
tanstarter create my-app --resume
```

To delete the Cloudflare and GitHub resources created by the CLI, run:

```bash
tanstarter delete my-app
```

## Presets

A preset decides which third-party accounts the generated site needs. The CLI writes it into the project's `src/config/preset.ts` as `ACTIVE_PRESET`; you can change tiers later by editing that one line and redeploying.

| Preset | Third-party accounts | What you get |
| --- | --- | --- |
| `free` | None | Blog, about page, and whatever tool or game you build on top. `git push` and you are live. |
| `account` | A mail service account, which auth depends on. A payment provider too, if you charge. | Accounts, billing, file storage. |
| `full` | The above, plus a newsletter account and a notification webhook. | Every module. |

- **Cloudflare resources are the same in all three tiers.** Every preset creates D1, R2, and KV and runs the migrations, because the Worker needs those bindings to boot. A `free` project therefore still owns three resources; they sit idle inside the free tiers and are not billed until used. `delete` removes all three regardless of preset.
- **`free` refuses payment.** `--preset free --payment waffo` exits with an error instead of silently ignoring the flag: `free` turns the account system off, so there is nothing for a subscription or an invoice to attach to.
- **`account` and `full` may skip payment.** `VITE_PAYMENT_PROVIDER` is left empty and you get a site with accounts but no checkout — the pricing page, billing page, and payment webhooks are all inactive.
- **The template must carry the preset layer.** If the cloned template has no `src/config/preset.ts`, or its `ACTIVE_PRESET` declaration no longer matches, the CLI fails right after the clone, before any Cloudflare resource is created.

## Prerequisites

- Node.js 20 or later.
- pnpm, to install dependencies and build this repository.
- A Cloudflare account with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` available in your shell environment.
- A GitHub account authenticated with GitHub CLI.
- (Waffo only) Create a Test API Key in the Waffo dashboard (API & Development → API Keys). Use the `MER_...` merchant ID as `WAFFO_MERCHANT_ID` and the private key value provided by Waffo as `WAFFO_PRIVATE_KEY`; the CLI passes that value through unchanged. The CLI always uses Waffo test mode and falls back to the deployed `workers.dev` URL when no custom domain is supplied.

The CLI checks for `node`, `pnpm`, `git`, `gh`, GitHub CLI auth, and Cloudflare credentials. If `pnpm`, `git`, or `gh` is missing, the CLI attempts to install it with the available system package manager before continuing.

### How third-party credentials reach the generated project

The CLI reads every value from `process.env` **once, when it starts**. It does
not read a `.env` file, does not prompt for these keys, and does not re-read
your shell later in the run. A key you did not `export` before launching ends
up empty in the generated `.env` and `.env.production`, and you only notice
after the site is live — Google sign-in, payments, or Turnstile silently do
nothing.

The full list of variables is the template's
[`env.example`](https://github.com/akfc58/tanstack-template/blob/main/env.example);
the generated env files are seeded from it, so it is the single source of truth.
The ones people usually want set before the first run:

| Area | Variables |
| --- | --- |
| Cloudflare (required) | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Transactional mail | `RESEND_API_KEY` |
| Bot protection | `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| Stripe / Creem payments | `STRIPE_*`, `CREEM_*`, and their `VITE_*_PRICE_*` / `VITE_*_PRODUCT_*` ids |
| Newsletter and notifications | `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID`, `DISCORD_WEBHOOK_URL`, `FEISHU_WEBHOOK_URL` |
| Analytics | `VITE_PLAUSIBLE_SCRIPT`, `VITE_UMAMI_SCRIPT`, `VITE_UMAMI_WEBSITE_ID`, `VITE_GOOGLE_ANALYTICS_ID`, `VITE_CLARITY_PROJECT_ID` |
| AI features | `AI_CHAT_PROVIDER`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `AI_COMPAT_*`, `FAL_KEY` |

Anything left empty can be filled in later by editing `.env.production` and
running `pnpm run sync-worker-secrets`.

### Variables the CLI decides for you

Exporting these has no effect — the CLI drops whatever your shell set and writes
its own values:

- `VITE_PAYMENT_PROVIDER`
- `WAFFO_DEBUG`, `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY`, `WAFFO_STORE_ID`,
  `VITE_WAFFO_PRODUCT_PRO_MONTHLY`, `VITE_WAFFO_PRODUCT_PRO_YEARLY`,
  `VITE_WAFFO_PRODUCT_LIFETIME`

(`WAFFO_MERCHANT_ID` and `WAFFO_PRIVATE_KEY` are still read from your shell as
setup credentials with `--payment waffo`; what the CLI controls is the value
written into the generated project.)

Without `--payment waffo`, `VITE_PAYMENT_PROVIDER` is written empty. That is a
site with accounts but no checkout: `/pricing` redirects, `/settings/billing`
is inactive, and payment webhooks do nothing. This is the most common source of
confusion right after the first deployment — set a provider in
`.env.production` and redeploy when you are ready to charge.

### Non-interactive Waffo setup

When running without a TTY, pass `--payment waffo`. No store/product fields or extra Waffo environment variables are required; the CLI uses the template's built-in pricing. `--domain` is optional:

```bash
npx tanstarter-cli@latest create my-app --payment waffo
```

The CLI creates a project-named store and three products matching the template: Pro Monthly at `$9.90`, Pro Yearly at `$99.00`, and Lifetime at `$199.00`. Their IDs are written to `VITE_WAFFO_PRODUCT_PRO_MONTHLY`, `VITE_WAFFO_PRODUCT_PRO_YEARLY`, and `VITE_WAFFO_PRODUCT_LIFETIME`, then the site is deployed, Worker secrets are synchronized, the public URL is verified, and `https://<domain>/api/webhooks/waffo` (or the deployed `workers.dev` equivalent) is registered. The deployed Worker keeps `WAFFO_DEBUG=true`, so the online site uses Waffo test payments.

The CLI always provisions Waffo in test mode. Live product publishing is outside this setup flow.

Waffo may still require merchant verification, business details, or payout setup in its dashboard.

## What It Does

The setup flow:

1. Clones the TanStarter template, preserves its Git history, and writes the chosen preset into `src/config/preset.ts`.
2. Installs dependencies with `pnpm install`.
3. Verifies Cloudflare authentication.
4. (Waffo only) Creates the Waffo store and three template products.
5. Creates Cloudflare D1, R2, and KV resources.
6. Updates `wrangler.jsonc` and writes `.env`/`.env.production`.
7. Runs database migrations.
8. Builds and deploys locally.
9. Syncs Worker secrets.
10. Verifies the public deployment URL.
11. (Waffo only) Registers the webhook after the deployed route is reachable.
12. Creates a GitHub repository and pins it as the gh default.
13. Syncs GitHub Actions secrets.
14. Commits and pushes to `main`.

The generated repository uses `origin` for your new GitHub repository and
`upstream` for `https://github.com/akfc58/tanstack-template.git`. Because the
template history is preserved, future template updates can use a normal Git
merge instead of reconstructing a common ancestor. The CLI also runs
`gh repo set-default` on your repository, so `gh run list`, `gh pr list`, and
`gh secret list` report on your project instead of resolving to the template
through the `upstream` remote.

The generated `.env` and `.env.production` start as full copies of the template's `env.example` manifest, so every variable it declares is present. Variables already set in your shell are filled in on top of that, and generated Cloudflare, D1, base URL, and auth secret values take precedence.

## Links:

- Website: [tanstarter.dev](https://tanstarter.dev)
- CLI documentation: [docs.tanstarter.dev/docs/cli](https://docs.tanstarter.dev/docs/cli)
- CLI video tutorial: [youtu.be/HVwilCX6YSA](https://youtu.be/HVwilCX6YSA)

## Support

If you have questions, contact [support@tanstarter.dev](mailto:support@tanstarter.dev) or join the [Discord community](https://mksaas.link/discord).

## License

MIT
