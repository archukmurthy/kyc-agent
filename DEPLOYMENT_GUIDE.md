# KYC Agent Deployment Guide — Complete Beginner, Windows

This guide assumes you've never used a terminal before. Every step is spelled out.

**Total time:** 60–90 minutes for your first deployment.
**What you'll end up with:** A live URL like `https://kyc-agent-xyz.vercel.app` that works on any device.

---

## Phase 1: Create Accounts (15 minutes)

### 1.1 Create your Anthropic account and get an API key

An API key is a secret password that lets the backend talk to Claude.

1. Open your browser and go to: **https://console.anthropic.com**
2. Click **"Sign Up"** in the top right (or Sign In if you already have an Anthropic account)
3. Follow the prompts to create an account (email + password, or sign in with Google)
4. Once you're logged in, look for **"API Keys"** in the left sidebar (or go directly to https://console.anthropic.com/settings/keys)
5. Click **"Create Key"**
6. Give it a name like `kyc-agent-demo`
7. **IMPORTANT:** A long string starting with `sk-ant-api...` will appear. **Copy it immediately and save it somewhere safe** (like a Notepad file on your desktop). You'll need it later and you can never see it again after closing this popup.

### 1.2 Add credit to your Anthropic account

Claude's API is pay-as-you-go. You need a small amount of credit loaded.

1. In the Anthropic Console, click **"Billing"** (or **"Plans & Billing"**) in the left sidebar
2. Click **"Add Credit"** or **"Buy Credits"**
3. Add **$5** (the minimum). This is more than enough for 30-50 demo searches.
4. Enter your card details and complete the purchase

### 1.3 Create a GitHub account

GitHub is where your code will live. Vercel pulls from GitHub to deploy.

1. Go to: **https://github.com**
2. Click **"Sign Up"**
3. Create an account (username + email + password)
4. Verify your email when GitHub sends you the verification

### 1.4 Create a Vercel account

Vercel is the service that actually runs your live website.

1. Go to: **https://vercel.com**
2. Click **"Sign Up"**
3. Choose **"Continue with GitHub"** (this connects the two accounts automatically)
4. Authorise Vercel to access your GitHub when prompted
5. Accept the free "Hobby" plan when asked

✅ **Checkpoint:** You should now have an Anthropic API key saved, $5 credit added, a GitHub account, and a Vercel account.

---

## Phase 2: Install Software on Your Windows Computer (15 minutes)

### 2.1 Install Node.js

Node.js is the runtime that lets React and the backend code run on your computer.

1. Go to: **https://nodejs.org**
2. You'll see two big download buttons. Click the one that says **"LTS"** (it means Long-Term Support and is the stable version)
3. Once the installer downloads, double-click it
4. Click **Next** through every screen. Accept the license, keep the default install location, leave all checkboxes at default
5. When the installer asks about "Tools for Native Modules", you can **uncheck that box** (we don't need it)
6. Click **Install**. Wait until it finishes, then click **Finish**

### 2.2 Install Git

Git is what moves your code to GitHub.

1. Go to: **https://git-scm.com/download/win**
2. The download should start automatically. If not, click the "64-bit Git for Windows Setup" link
3. Double-click the installer when it downloads
4. Click **Next** through every screen. **Accept all the defaults** — there are a lot of screens, but defaults are fine
5. When it finishes, click **Finish**

### 2.3 Open PowerShell (your terminal)

PowerShell is Windows' terminal. It's how you'll run commands.

1. Press the **Windows key** on your keyboard
2. Type: `powershell`
3. Click **"Windows PowerShell"** when it appears
4. A blue or black window opens with a blinking cursor. This is your terminal.

### 2.4 Verify everything installed correctly

In the PowerShell window, type this exactly and press Enter:

```
node --version
```

You should see something like `v20.11.0`. If you get an error saying "not recognized", close PowerShell, reopen it, and try again. If it still fails, restart your computer and try once more.

Now type:

```
git --version
```

You should see something like `git version 2.43.0`.

✅ **Checkpoint:** Both commands showed version numbers. If yes, move on. If not, the installation didn't complete correctly — reinstall whichever one failed.

---

## Phase 3: Set Up the Project (10 minutes)

### 3.1 Download the project files

You have a folder called `kyc-agent-deploy` in your Claude outputs. Download it to your computer:

1. Save it to your **Desktop** so it's easy to find
2. The folder should contain:
   - `api/research.js`
   - `src/App.js`
   - `src/index.js`
   - `public/index.html`
   - `package.json`
   - `vercel.json`
   - `.gitignore`

### 3.2 Navigate to the project in PowerShell

In the PowerShell window, type this and press Enter (replace `YourUsername` with your actual Windows username):

```
cd $HOME\Desktop\kyc-agent-deploy
```

(`cd` means "change directory". `$HOME\Desktop` is your Desktop folder. If you put the folder somewhere else, adjust the path.)

To confirm you're in the right place, type:

```
dir
```

You should see the files listed: `api`, `src`, `public`, `package.json`, etc.

### 3.3 Install the project dependencies

This downloads all the code libraries the project needs (React, etc.).

In PowerShell, type:

```
npm install
```

Press Enter and **wait**. This will take 2–5 minutes and print a lot of text. You'll know it's done when your cursor comes back to a clean line with `PS C:\...>`. It's normal to see some yellow "warnings" — ignore them unless they say "error".

### 3.4 Test the app locally (optional but recommended)

Before deploying, make sure the frontend at least builds:

```
npm run build
```

Wait 1-2 minutes. At the end you should see something like "Compiled successfully". If you see errors, copy them and ask me.

✅ **Checkpoint:** `npm install` finished and `npm run build` compiled successfully.

---

## Phase 4: Put the Code on GitHub (10 minutes)

### 4.1 Create a new repository on GitHub

1. Go to: **https://github.com/new** (in your browser, while logged into GitHub)
2. **Repository name:** `kyc-agent` (or anything you like, no spaces)
3. Leave it set to **"Public"** (it's free and fine for a demo — the sensitive API key lives on Vercel, not in the code)
4. **Do NOT** check any of the "Initialize" boxes (no README, no .gitignore, no license)
5. Click **"Create repository"**
6. On the next page, you'll see a URL that looks like `https://github.com/YourUsername/kyc-agent.git`. **Copy that URL** — you'll need it in a moment.

### 4.2 Configure Git with your identity

Back in PowerShell, type these two commands (replace with your actual info):

```
git config --global user.email "your-email@example.com"
git config --global user.name "Your Name"
```

### 4.3 Push your code to GitHub

Still in PowerShell, still in the `kyc-agent-deploy` folder, run these commands **one at a time**, pressing Enter after each:

```
git init
```

```
git add .
```

```
git commit -m "Initial commit"
```

```
git branch -M main
```

Now the important one — paste the GitHub URL you copied:

```
git remote add origin https://github.com/YourUsername/kyc-agent.git
```

(Replace `YourUsername` with your actual GitHub username.)

Finally:

```
git push -u origin main
```

**The first time you push**, a popup window will open asking you to sign in to GitHub. Sign in with your GitHub username and password (or use the browser sign-in option). Once you authenticate, the code uploads.

### 4.4 Verify it worked

Go back to your browser and refresh the GitHub page (`https://github.com/YourUsername/kyc-agent`). You should now see all your files listed there.

✅ **Checkpoint:** Your code is visible on GitHub.

---

## Phase 5: Deploy to Vercel (10 minutes)

### 5.1 Import your project into Vercel

1. Go to: **https://vercel.com/new**
2. You'll see a list of your GitHub repositories. Find **`kyc-agent`** and click **"Import"**
3. On the next screen, Vercel will auto-detect it's a Create React App project. Leave all the settings at default.
4. **IMPORTANT: Click "Environment Variables"** (it's a small dropdown/section on this screen)
5. Add a new environment variable:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** Paste your API key (the `sk-ant-api...` one you saved earlier)
6. Click **"Add"**
7. Click the big **"Deploy"** button at the bottom

### 5.2 Wait for deployment

Vercel will now build and deploy your site. This takes about 2–3 minutes. You'll see a progress log. When it's done, you'll see:

- A "Congratulations!" screen with confetti
- A preview of your site
- A URL like `https://kyc-agent-abc123.vercel.app`

### 5.3 Test your live site

1. Click the URL Vercel gives you, or copy it and paste into a new browser tab
2. The KYC Onboarding Agent should load
3. Type **"Tesco PLC"**, select **"GB — United Kingdom"**, and click **"Research Company"**
4. Wait 20–30 seconds. You should see the researched company data appear.

### 5.4 Share it

That URL is now your live demo. You can:
- Send it to Prajit or anyone else
- Open it on your phone, tablet, or any computer
- Use it during a live presentation

✅ **Checkpoint:** Your agent is live on the internet and working.

---

## Troubleshooting

**"Research failed" on the live site:**
- Most common cause: API key not set correctly in Vercel
- Go to your Vercel project → Settings → Environment Variables → confirm `ANTHROPIC_API_KEY` is there
- If you just added/fixed it, you must **redeploy**: go to Deployments tab → click the three dots on the latest deployment → click "Redeploy"

**"npm install" errors:**
- Usually means Node.js didn't install correctly. Close PowerShell, reopen, try `node --version` again
- If that fails, uninstall Node.js, restart your computer, reinstall

**"git push" asks for password and your password doesn't work:**
- GitHub now requires a "Personal Access Token" instead of your password
- Go to https://github.com/settings/tokens → Generate new token (classic) → check "repo" scope → generate → copy the token
- Use that token as the password when git asks

**Build fails on Vercel:**
- Go to the Deployments tab in Vercel, click the failed deployment, look at the error log
- Copy any error messages and share them with me

---

## Making Changes After Deployment

When you want to update the code:

1. Edit the files on your computer (in the `kyc-agent-deploy` folder on your Desktop)
2. Open PowerShell, navigate to the folder: `cd $HOME\Desktop\kyc-agent-deploy`
3. Run these three commands:

```
git add .
git commit -m "describe what you changed"
git push
```

4. Vercel will automatically detect the change and redeploy in 1-2 minutes
5. Your live URL stays the same, but shows the new version

---

## Cost Summary

- **Vercel:** Free forever on the Hobby plan (unless you get millions of visitors)
- **GitHub:** Free for public repositories
- **Anthropic API:** Pay per use. Typical usage for a demo: $0.05–$0.15 per company search. $5 credit = roughly 30–100 searches.

You'll get an email from Anthropic when your credit gets low. You can add more or stop using it.

---

## When You Get Stuck

Copy any error message you see (in PowerShell or on Vercel) and paste it into your conversation with Claude. Include:
- Which phase and step you're on
- What command you ran
- The exact error message

Claude can help you debug from there.

Good luck with your deployment!
