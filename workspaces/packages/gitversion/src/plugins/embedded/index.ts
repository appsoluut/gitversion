import { gitPlugins } from './git';
import { gradlePlugins } from './gradle';
import { nodePlugins } from './node';

export * from './git';
export * from './gradle';
export * from './node';

export const embeddedPlugins = [
  ...gitPlugins,
  ...nodePlugins,
  ...gradlePlugins,
];
