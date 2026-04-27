# 🚀 Ideer Launchpad

**Skip the boilerplate, ship the vibe.** A launchpad for vibe-coded projects—not another "SaaS kit." Hack speed, human scale. This repo's on the house for our crew.

## ✨ What's Included

### 🔐 Authentication & User Management
- **Clerk Integration** - Google OAuth, Magic Links, secure sessions
- **Role-based Access Control** - User/Admin roles with protected routes
- **Automatic User Sync** - Seamless Clerk → Convex user synchronization

### 🗄️ Database & Backend
- **Convex Real-time Database** - No API endpoints to maintain
- **Automatic Sync** - Real-time data updates across all clients
- **Admin Dashboard** - User management and system administration

### 📧 Email System
- **Resend Integration** - Professional email delivery
- **Welcome Emails** - Automatic onboarding emails for new users
- **Email Testing** - Built-in admin tools for email testing

### 🤖 AI Integration
- **OpenAI API** - Built-in AI chat functionality
- **Admin AI Tools** - Test prompts and interact with AI models
- **Configurable Models** - Support for different OpenAI models

### 📊 Analytics & Monitoring
- **Microsoft Clarity** - User behavior tracking and heatmaps
- **Performance Monitoring** - Core Web Vitals tracking
- **Error Logging** - Built-in error monitoring

### 🎨 Modern UI/UX
- **Tailwind CSS** - Utility-first styling
- **Shadcn/ui Components** - Beautiful, accessible components
- **Responsive Design** - Mobile-first approach
- **Dark/Light Mode** - Theme switching support

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### First-Time Setup (Recommended)

After cloning, run the guided setup script. It will walk you through Convex, Clerk, and API key configuration:

```bash
git clone <your-repo-url>
cd ideer-launchpad
npm run setup:new "Your Project Name"
```

The setup will:
1. **Convex** - Guide you to run `npx convex dev`, log in, and create a project
2. **Clerk** - Open the dashboard so you can create an app and copy API keys
3. **API Keys** - Prompt for Resend, OpenAI (optional), and Clarity (optional)
4. **Convex env** - Push RESEND_API_KEY, EMAIL_FROM, APP_BASE_URL (and OPENAI_API_KEY if provided) to your Convex deployment

### Manual Setup

If you prefer to configure manually:

1. Copy `.env.template` to `.env.local`
2. Run `npx convex dev` to create/link a Convex project
3. Create a Clerk app at [dashboard.clerk.com](https://dashboard.clerk.com/) and add `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
4. Add your Resend API key, EMAIL_FROM, and APP_BASE_URL
5. Push Convex env vars: `npx convex env set RESEND_API_KEY "re_..."` (and EMAIL_FROM, APP_BASE_URL, OPENAI_API_KEY as needed)

### Happier Block production (`happierblock.com`)

After DNS points to your host (e.g. Vercel), align these so auth, CORS, and links match **https://happierblock.com**:

- **Convex**: `npx convex env set PUBLIC_BASE_URL "https://happierblock.com"` — used for homeowner/portal URLs in backend ([convex/properties.ts](convex/properties.ts)). Set `CLERK_SECRET_KEY` if you use server-side member provisioning.
- **Clerk dashboard**: Allowed origins and redirect URLs must include `https://happierblock.com` (and `https://www.happierblock.com` if you use `www`).
- **Upload server** ([server/index.js](server/index.js)): set `ALLOWED_ORIGIN=https://happierblock.com` (or the canonical origin you use) so inspector uploads work from production.
- **Resend**: verify sending domain; set `RESEND_FROM` like `Happier Block <noreply@happierblock.com>` once the domain is verified.

### PWA (install on phone)

Production builds use **vite-plugin-pwa** (service worker + web manifest). Icons are generated from `public/favicon.svg` via `npm run pwa:icons` (also runs before `npm run build`). Manual install checks: [docs/pwa-verification.md](docs/pwa-verification.md).

### Demo HOA seed

Creates a **scoped** demo HOA (`slug`: `demo-happier-block`) with fake streets and properties, then assigns **admin** membership to a Clerk user id. It does **not** run the destructive global backfill in `multiHoa.seedRidgeTopTerraceAndBackfill`.

**Warning:** the app uses a **single** `userHoaMemberships` row per Clerk user ([`convex/lib/tenantAuth.ts`](convex/lib/tenantAuth.ts)). Seeding will **move** that user’s membership to the demo HOA if they already belonged elsewhere.

1. Set a secret on Convex (use a long random string on shared deployments): `npx convex env set DEMO_SEED_SECRET "your-secret"`
2. From your machine (same secret in the shell):

```bash
export CONVEX_URL="https://YOUR_DEPLOYMENT.convex.cloud"
export DEMO_SEED_SECRET="same-as-convex-env"
# Or put DEMO_SEED_SECRET in `.env.local`; `npm run seed:demo` loads it when unset in the shell.
npm run seed:demo
```

Optional args: `npm run seed:demo -- <clerkUserId> <adminEmail>` (defaults to the repo’s demo admin Clerk id and `mdehart.ph@gmail.com`). Add `--force` anywhere in the args to insert any missing `DEMO - …` addresses even when the HOA already has 12+ properties (templates, AI config, and demo property enrichment still run every time).

**Verify:** sign in as that Clerk user, open `/admin/dashboard`, confirm HOA name/slug and `DEMO - …` properties, letter template, and that at least one complete demo row has generated letter HTML (and one marked sent). Confirm unrelated HOAs were not modified.

### Deploy

```bash
npm run build
npm run deploy:all
```

## 🏗️ Architecture

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development and building
- **React Router** for client-side routing
- **TanStack Query** for data fetching

### Backend
- **Convex** for real-time database and serverless functions
- **Clerk** for authentication and user management
- **Resend** for email delivery
- **OpenAI** for AI functionality

### Deployment
- **Vercel** optimized with proper rewrites
- **Code splitting** for optimal loading
- **Performance monitoring** built-in

## 🎯 Features Deep Dive

### Authentication Flow
1. User signs up/in via Clerk
2. Automatic sync to Convex database
3. Role assignment (user/admin)
4. Protected route access

### Email System
1. New user registration triggers welcome email
2. Admin dashboard for email testing
3. Resend integration for reliable delivery
4. Customizable email templates

### Admin Dashboard
- View all users and their roles
- Promote/demote users to admin
- Test email functionality
- AI chat interface for testing prompts
- User statistics and analytics

## 🛠️ Customization

### Adding New Pages
1. Create component in `src/pages/`
2. Add route to `src/App.tsx`
3. Update navigation in `src/components/ui/navbar.tsx`

### Styling
- Modify `tailwind.config.js` for design tokens
- Update components in `src/components/ui/`
- Customize themes in `src/index.css`

### Database Schema
- Edit `convex/schema.ts` to add new tables
- Create queries/mutations in `convex/` directory
- Update TypeScript types automatically

## 📁 Project Structure

```
src/
├── components/
│   ├── ui/              # Reusable UI components
│   ├── sections/        # Page sections (hero, features, etc.)
│   ├── admin/           # Admin-specific components
│   └── analytics/       # Analytics components
├── pages/               # Route components
├── hooks/               # Custom React hooks
├── lib/                 # Utility functions
└── convex/              # Backend functions and schema

public/
├── favicon.svg          # Custom favicon
└── robots.txt           # SEO configuration
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - feel free to use this as a starting point for your own projects!

## 🆘 Support

- Check the [Issues](https://github.com/your-repo/issues) for common problems
- Join our community for discussions
- Follow [@bigideer](https://twitter.com/bigideer) for updates

---

**Built with ❤️ by the Big Ideer team**

*Part of the "26 Products by 2026" challenge - small, fast, elegant experiments that prove ideas in the wild.*