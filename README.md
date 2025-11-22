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
- **Styling**: Tailwind CSS + Shadcn/ui components
- **Backend**: Supabase (Database + Authentication)
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (preferred) or npm

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

3. Create environment file:
```bash
cp .env.example .env
```

4. Add your Supabase credentials to `.env`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

5. Start development server:
```bash
pnpm dev
```

### Build for Production

```bash
pnpm build
```

## Deployment

This app is deployed on Vercel and automatically builds and deploys on every push to the main branch.

## Environment Variables

- `VITE_SUPABASE_URL`: Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Your Supabase anonymous key

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