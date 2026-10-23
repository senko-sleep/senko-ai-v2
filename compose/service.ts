import nextjs from '@prisma/composer/nextjs';
import { compute } from '@prisma/composer-prisma-cloud';

// The Next.js app as a Prisma Compute service. `next build` with standalone output
// (NEXT_OUTPUT_STANDALONE=1, set by the deploy workflow) is the whole build; the deploy
// copies in .next/static and public/ itself.
export default compute({
  name: 'web',
  deps: {},
  build: nextjs({ module: import.meta.url, appDir: '..' }),
});
