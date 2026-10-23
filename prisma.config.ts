// Control-plane config for Prisma Composer (read by `prisma deploy`, never imported by
// the app). Registers the Prisma Cloud target and the Next.js build adapter.
import { defineConfig as composer } from '@prisma/composer/config';
import { nextjsBuild } from '@prisma/composer/nextjs/control';
import { prismaCloud, prismaState } from '@prisma/composer-prisma-cloud/control';
import { definePrismaConfig } from 'prisma/config';

export default definePrismaConfig({
  composer: composer({
    extensions: [prismaCloud(), nextjsBuild()],
    state: prismaState(),
  }),
});
