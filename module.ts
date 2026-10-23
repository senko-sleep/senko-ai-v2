import { module } from '@prisma/composer';
import webService from './compose/service.ts';

/**
 * Prisma Composer description of the app, deployed to the Prisma project "senko-ai"
 * by .github/workflows/prisma-deploy.yml (default branch -> production, other branches
 * -> previews).
 *
 * One service: the Next.js app. It keeps using the existing Postgres (DATABASE_URL)
 * and reads its settings (API keys, etc.) from environment variables set on the
 * Prisma project. The browser agent can't run on Compute (no Chrome), so agent
 * calls go to the Vercel Sandbox agent computer (AGENT_HOST=sandbox).
 */
export default module('senko-ai', ({ provision }) => {
  provision(webService);
});
