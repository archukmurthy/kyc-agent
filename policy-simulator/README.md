# UK KYB Policy Simulator

## What this is

The UK KYB Policy Simulator is a single-purpose sales-enablement tool that turns a structured configuration into a discussion-ready KYB policy using Claude. It is not legal or regulatory advice, a compliance assessment, or a production compliance tool; an MLRO must review, adapt, and approve any output before use.

## Prerequisites

Node.js 20 or newer and npm 10 or newer.

## Setup

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:5173`.

## Environment variable

Set `ANTHROPIC_API_KEY` in `.env.local` using an API key created in the [Anthropic Console](https://console.anthropic.com/settings/keys). The key is read only by the local/serverless API endpoint and is never included in the browser bundle.

## Deployment

Create a new Vercel project with `policy-simulator` as its root directory, add `ANTHROPIC_API_KEY` in Project Settings → Environment Variables, and deploy through the Vercel dashboard or `vercel --prod`. Vercel builds the Vite frontend and deploys the single `api/generate-policy.js` function that protects the secret.

## What it does not do

- Provide legal or regulatory advice or make compliance decisions
- Save configurations, policies, sessions, or user data
- Offer authentication, accounts, analytics, or administration
- Generate PDFs, send email, edit, compare, share, or version policies
- Support jurisdictions or policy types other than UK KYB
- Connect to registries, vendors, regulatory feeds, or databases
