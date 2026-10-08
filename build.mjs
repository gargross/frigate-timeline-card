import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/frigate-timeline-card.ts'],
  outdir: 'dist',
  entryNames: '[name]',
  chunkNames: 'ftc-[name]-[hash]',
  splitting: true,
  bundle: true,
  format: 'esm',
  target: 'es2021',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
