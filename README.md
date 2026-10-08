# Vocabulary Learning App

A modern, responsive vocabulary learning application built with React, TypeScript, and Supabase.

## Features

- **Dark Theme**: Beautiful dark/light theme with system preference detection
- **User Authentication**: Secure login/signup with Supabase
- **Vocabulary Management**: Add, edit, and delete words with definitions and translations
- **Practice Modes**: 
  - Free Mode: Interactive translation practice
  - Test Mode: Formal testing with score tracking
- **Progress Tracking**: Detailed statistics and achievement system
- **Responsive Design**: Works perfectly on desktop and mobile devices
- **Real-time Sync**: Data synced across devices with Supabase

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Backend**: Supabase (Database + Authentication)
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 20+ for the app and Vitest 4; the full test suite requires Node.js 22+ because the existing jest-dom 7 dependency requires it. Node.js 24 LTS is recommended and matches Quality CI.
- pnpm 10.34.6 (pinned in `package.json`)

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd vocabulary-learning-app
```

2. Install dependencies:
```bash
pnpm install
```

3. Copy `.env.example` to `.env.local` using your editor or file manager.

4. Set your Supabase client configuration in `.env.local` (this file is ignored by Git; do not commit it):
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

5. Start development server:
```bash
pnpm dev
```

Install dependencies separately when the lockfile changes. `dev`, `lint`, and `preview` do not install packages. Run `pnpm lint` and `pnpm test` for local checks, or `pnpm test:watch` while editing tests. pnpm explicitly approves only esbuild's dependency build script; no interactive `approve-builds` step is required.

### Build for Production

```bash
pnpm build
```

`build` typechecks and builds on Windows, macOS, and Linux; `build:prod` delegates to the same command. `pnpm preview` serves the built output. Source-identifier metadata is enabled only in the development server and is omitted from every build, regardless of mode; no `BUILD_MODE` variable is needed.

`pnpm clean` removes `dist`, `coverage`, `.eslintcache`, and the Vite/TypeScript caches in `node_modules/.vite`, `.vite-temp`, and `.tmp`. It preserves installed dependencies, `pnpm-lock.yaml`, and local environment files.

## Deployment

This app is deployed on Vercel and automatically builds and deploys on every push to the main branch.

In the Vercel project's **Environment Variables**, configure both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for **Preview** and **Production**, then redeploy. These values are embedded by Vite at build time. A successful build does not prove they are configured: the browser app fails at startup if either value is missing or blank. There are no hardcoded fallbacks.

## Environment Variables

- `VITE_SUPABASE_URL`: Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Your Supabase anon or publishable client key (never a service-role key)

Both values are required. Set them locally in `.env.local`, then restart Vite after changes. These `VITE_` values are public browser configuration. Tests mock Supabase and need no real project credentials.

## Features Overview

### 🔐 Authentication
- Secure user registration and login
- Email-based authentication via Supabase
- Protected routes and user session management

### 📝 Word Management
- Add words with foreign language and translation
- Edit existing vocabulary entries
- Delete words with confirmation
- Search and filter functionality

### 🎯 Practice Modes
- **Free Mode**: Interactive translation practice with immediate feedback
- **Test Mode**: Formal assessment with multiple-choice questions
- Randomized word selection
- Configurable translation directions

### 📊 Progress Tracking
- Real-time statistics
- Accuracy percentage tracking
- Achievement badges
- Historical test results

### 🎨 User Experience
- Dark/Light theme toggle
- System preference detection
- Smooth animations and transitions
- Mobile-responsive design
- Error boundaries for stability

## Database Schema

The app uses Supabase with the following main tables:
- `profiles`: User profile information
- `words`: Vocabulary words with translations
- `test_history`: Test results and statistics

## Author

Built by MiniMax Agent
