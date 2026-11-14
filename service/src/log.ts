const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export const log = {
  info: (m: string) => console.log(`${ts()}  ${m}`),
  warn: (m: string) => console.warn(`${ts()}  ⚠ ${m}`),
  /** For things a person must look at (e.g. a sweep that keeps failing). */
  loud: (m: string) => console.error(`\n${ts()}  ‼‼ ${m}\n`),
};
